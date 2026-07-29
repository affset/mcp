#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

/**
 * Entry point. Runs the affset MCP server over stdio.
 *
 * IMPORTANT: stdout is the JSON-RPC channel — all diagnostics go to stderr.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`affset-mcp ready (namespace: ${config.namespace}, base: ${config.baseUrl})`);
}

main().catch((err) => {
  console.error(`affset-mcp failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
