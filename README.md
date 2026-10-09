[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/ivelin-web-tempo-mcp-server-badge.png)](https://mseep.ai/app/ivelin-web-tempo-mcp-server)

# Tempo MCP Server

A Model Context Protocol (MCP) server for retrieving Tempo worklogs through Tempo's API.
It returns raw issue IDs for a separately configured Jira MCP to resolve, and requires only a Tempo API token.

[![npm version](https://img.shields.io/npm/v/@ivelin-web/tempo-mcp-server.svg)](https://www.npmjs.com/package/@ivelin-web/tempo-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- Retrieve every worklog visible to your Tempo token in a date range, with pagination.
- Return worklog IDs, raw issue and author account IDs, hours, descriptions, start times, and work attributes.
- Run locally over stdio.

## System Requirements

- Node.js 18+.
- A Tempo API token with **Worklogs (View)** access and permission to view the requested worklogs.

## Changes in this fork

This fork supports only `retrieveWorklogs(startDate, endDate)`.
All management functions (`createWorklog`, `bulkCreateWorklogs`, `editWorklog`, `deleteWorklog`, `getMissingWorklogDays`, and `getWorklogAnalytics`) and Jira-dependent filters with `users`, `program` or `team` are removed.

Retrieval now returns everything Tempo permits the token to view in the date range, rather than resolving the authenticated Jira user and filtering to their worklogs.
Multiple authors are returned if the token can view them.
Results contain raw issue IDs and author account IDs, with no issue keys, summaries, email addresses, or resolved display names.

Please use the Atlassian Rovo MCP to resolve the issue IDs.

Since this fork no longer depends on Jira, the `JIRA_*` environment variables are removed from the configuration.

## Usage Options

We only intend for local stdio deployment.

```bash
git clone https://github.com/kennytm/tempo-mcp-server.git
cd tempo-mcp-server
npm install
npm run build
```

Configure your client with the absolute path to the compiled entrypoint:

```json
{
  "mcpServers": {
    "Tempo": {
      "command": "node",
      "args": ["/absolute/path/to/tempo-mcp-server/build/index.js"],
      "env": {
        "TEMPO_API_TOKEN": "your_tempo_api_token_here"
      }
    }
  }
}
```

For development, use `npm run dev` or `npm run inspect` with `TEMPO_API_TOKEN` set in the process environment.
`.env.example` documents the token; the server does not automatically load `.env` files.

## Authentication and permissions

Create a token in Tempo → Settings → API Integration with **Worklogs (View)** access.
The server sends it as a bearer token to `https://api.tempo.io/4`.
Tempo decides which worklogs are visible.
An empty result means no worklogs were returned for this token and range; it does not establish whether other users have logged time that the token cannot view.

## Tool: retrieveWorklogs

Both transports expose one read-only tool:

| Parameter   | Required | Format                                |
| ----------- | -------- | ------------------------------------- |
| `startDate` | Yes      | `YYYY-MM-DD`                          |
| `endDate`   | Yes      | `YYYY-MM-DD`, on or after `startDate` |

The server requests `GET /4/worklogs` with `from`, `to`, `offset`, and `limit`, combining pages up to a 500-page safety cap.
If the cap is reached or pagination cannot advance, the call fails rather than reporting incomplete results as complete.

Each returned text entry contains the Tempo worklog ID, raw issue ID, author account ID when present, date, hours, description, and any start time/attributes.
For example:

```text
TempoWorklogId: 126 | IssueId: 10001 | AuthorAccountId: account-id | Date: 2026-10-08 | Hours: 2.00 | Description: Investigation
```

The raw `IssueId` is available for a separate Jira MCP to resolve.
No user or issue lookup is performed by this server.
A malformed record without an issue ID is marked `IssueId: Missing` while its remaining data is retained.

## Development checks

```bash
npm run lint -- --quiet
npm run format:check
npm run build
npm run remote:typecheck
npm test
```

The tests use mocked upstream responses and exercise MCP tool discovery/calls, Tempo pagination, validation, onboarding, and legacy encrypted credentials without live tokens.

## Project Structure

```text
src/
├── config.ts         # Stdio environment configuration
├── index.ts          # Stdio MCP entrypoint
├── tools.ts          # Tempo retrieval
├── types.ts          # Shared types and input schemas
├── utils.ts          # Tempo error formatting
└── remote/
    ├── agent.ts      # Per-request MCP server
    ├── setup.ts      # Tempo token onboarding
    ├── storage.ts    # Encrypted KV credential storage
    └── worker.ts     # Worker routing
server.test.mjs       # Mocked integration tests
```

## Troubleshooting

- Verify `TEMPO_API_TOKEN` is nonempty and has permission to view worklogs.
- Check that the date range is valid and narrow it if retrieval reaches the page cap.
- Inspect stderr for startup errors or run `npm run inspect`.
- For remote credential or deployment problems, see the deployment troubleshooting above.

## License

[MIT](LICENSE)

## Credits

This server implements the [Model Context Protocol](https://modelcontextprotocol.io/) specification created by Anthropic.
