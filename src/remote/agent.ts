/**
 * Each request gets a fresh McpServer so transports and credentials cannot leak
 * between tenants. The MCP SDK also rejects server/transport reuse.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ctx, retrieveWorklogsSchema } from '../types.js';
import { createTools, RETRIEVE_WORKLOGS_DESCRIPTION } from '../tools.js';
import { UserCredentials } from './storage.js';

const SERVER_NAME = 'tempo-mcp-server';
const SERVER_VERSION = '2.0.0';

export function ctxFromCreds(creds: UserCredentials): Ctx {
  return {
    tempoApi: {
      baseUrl: 'https://api.tempo.io/4',
      token: creds.tempoApiToken,
    },
  };
}

export function buildMcpServer(creds: UserCredentials): McpServer {
  const tools = createTools(ctxFromCreds(creds));
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  server.registerTool(
    'retrieveWorklogs',
    {
      description: RETRIEVE_WORKLOGS_DESCRIPTION,
      inputSchema: retrieveWorklogsSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ startDate, endDate }) => {
      const result = await tools.retrieveWorklogs(startDate, endDate);
      return {
        content: result.content,
        ...(result.isError && { isError: true }),
      };
    },
  );

  return server;
}
