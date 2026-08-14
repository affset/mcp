/**
 * Runtime-agnostic library surface of @affset/mcp (REMOTE-MCP-PRD.md §5.6).
 *
 * Everything exported here runs on any fetch-capable runtime (Node ≥22.13,
 * Cloudflare Workers) — no `process.env`, no `node:` imports. The stdio
 * entrypoint (`dist/index.js`, the `affset-mcp` bin) layers env-var loading on
 * top of this; the remote MCP gateway imports this surface directly and
 * supplies per-grant credentials instead.
 *
 * `loadConfig` (env-var parsing) is deliberately NOT exported: it is the
 * stdio entrypoint's concern, and its signature drags Node types into
 * consumers.
 */
export {
  registerAffsetTools,
  type AffsetToolServer,
  type RegisterAffsetToolsOptions,
  type ToolCallEvent,
} from "./registerTools.js";
export type { Config } from "./runtimeConfig.js";
export { AffsetClient, AffsetApiError } from "./client.js";
export { DOCS_FEEDS, fetchDocsFeed, DocsFetchError, type DocsFeed } from "./docs.js";
export { VERSION } from "./version.js";
