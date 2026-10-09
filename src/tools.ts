import axios from 'axios';
import {
  Ctx,
  TempoWorklog,
  TempoWorklogPage,
  ToolResponse,
  retrieveWorklogsSchema,
} from './types.js';
import { formatError } from './utils.js';

const TEMPO_PAGE_LIMIT = 1000;
const MAX_PAGES = 500;

export const RETRIEVE_WORKLOGS_DESCRIPTION =
  'Retrieve all Tempo worklogs visible to TEMPO_API_TOKEN in a date range. ' +
  'Results may include multiple authors if the token can view them. Returns raw ' +
  'issue IDs and author account IDs without resolving names or issue keys. ' +
  'Use a separately configured Jira MCP to resolve issue IDs if needed.';

export interface Tools {
  retrieveWorklogs(startDate: string, endDate: string): Promise<ToolResponse>;
}

export function createTools(ctx: Ctx): Tools {
  const api = axios.create({
    baseURL: ctx.tempoApi.baseUrl,
    headers: {
      Authorization: `Bearer ${ctx.tempoApi.token}`,
      'Content-Type': 'application/json',
    },
  });

  async function fetchAllWorklogs(startDate: string, endDate: string) {
    const worklogs: TempoWorklog[] = [];
    let offset = 0;
    let pagesProcessed = 0;

    while (pagesProcessed < MAX_PAGES) {
      const response = await api.get<TempoWorklogPage>('/worklogs', {
        params: {
          from: startDate,
          to: endDate,
          offset,
          limit: TEMPO_PAGE_LIMIT,
        },
      });
      const page = response.data;
      const results = page.results ?? [];
      worklogs.push(...results);
      pagesProcessed++;
      if (!page.metadata?.next) return { worklogs, pagesProcessed };

      // Only the continuation signal is used: requests stay on Tempo's worklog
      // endpoint rather than following response URLs that may point elsewhere.
      const limit = page.metadata.limit ?? TEMPO_PAGE_LIMIT;
      const pageOffset = page.metadata.offset ?? offset;
      const nextOffset = pageOffset + limit;
      if (
        !Number.isSafeInteger(limit) ||
        limit <= 0 ||
        pageOffset !== offset ||
        !Number.isSafeInteger(nextOffset) ||
        nextOffset <= offset ||
        results.length === 0
      ) {
        throw new Error('Tempo worklog pagination did not advance.');
      }
      offset = nextOffset;
    }

    throw new Error(
      `Reached maximum page limit (${MAX_PAGES}) while fetching worklogs ` +
        `for ${startDate}..${endDate}. Results would be incomplete — ` +
        'narrow the date range and try again.',
    );
  }

  return {
    async retrieveWorklogs(startDate, endDate) {
      try {
        retrieveWorklogsSchema.parse({ startDate, endDate });
        if (startDate > endDate) {
          throw new Error('startDate must be on or before endDate.');
        }
        const { worklogs, pagesProcessed } = await fetchAllWorklogs(
          startDate,
          endDate,
        );
        const content = worklogs.map((worklog) => {
          const issueId =
            worklog.issue?.id == null ? 'Missing' : String(worklog.issue.id);
          const authorInfo = worklog.author?.accountId
            ? ` | AuthorAccountId: ${worklog.author.accountId}`
            : '';
          const startTimeInfo = worklog.startTime
            ? ` | StartTime: ${worklog.startTime}`
            : '';
          const attributes = worklog.attributes?.values;
          const attributesInfo = attributes?.length
            ? ` | Attributes: ${JSON.stringify(attributes)}`
            : '';
          return {
            type: 'text' as const,
            text:
              `TempoWorklogId: ${worklog.tempoWorklogId ?? 'Unknown'} | IssueId: ${issueId}${authorInfo} | ` +
              `Date: ${worklog.startDate}${startTimeInfo} | Hours: ${(worklog.timeSpentSeconds / 3600).toFixed(2)} | ` +
              `Description: ${worklog.description ?? 'No description'}${attributesInfo}`,
          };
        });
        return {
          content:
            content.length > 0
              ? content
              : [
                  {
                    type: 'text',
                    text: 'No worklogs found for the specified date range.',
                  },
                ],
          metadata: {
            totalCount: worklogs.length,
            pagesProcessed,
            startDate,
            endDate,
          },
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error retrieving worklogs: ${formatError(error)}`,
            },
          ],
        };
      }
    },
  };
}
