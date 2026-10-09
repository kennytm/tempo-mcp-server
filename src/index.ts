#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import config from './config.js';
import { createTools, RETRIEVE_WORKLOGS_DESCRIPTION } from './tools.js';
import { retrieveWorklogsSchema } from './types.js';

async function startServer(): Promise<void> {
  try {
    const tools = createTools({ tempoApi: config.tempoApi });
    const server = new McpServer(config.server);

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

    await server.connect(new StdioServerTransport());
    console.error('[INFO] MCP Server started successfully');
  } catch (error) {
    console.error(
      `[ERROR] Failed to start MCP Server: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

startServer().catch((error: unknown) => {
  console.error(
    `[ERROR] Unhandled exception: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
