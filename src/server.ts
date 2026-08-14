import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./runtimeConfig.js";
import { registerAffsetTools } from "./registerTools.js";
import { VERSION } from "./version.js";

/** Build the MCP server with the affset tools registered against `config`. */
export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: "affset-mcp",
    version: VERSION,
  });
  registerAffsetTools(server, config);
  return server;
}
