import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "./config.js";
import { registerAffsetTools, type ToolCallEvent } from "./registerTools.js";

/**
 * Golden tool rosters. The remote gateway (lite-adserver/mcp-gateway) asserts
 * the same lists over live tools/list in its integration suite — a change here
 * must be intentional and lands in both places, keeping stdio and the remote
 * server from drifting (REMOTE-MCP-PRD.md §7 P2 "tool parity").
 */
const FULL_ROSTER = [
  "create_campaign",
  "create_team_member",
  "create_zone",
  "cut_zones",
  "delete_payout_rule",
  "get_campaign",
  "get_stats",
  "get_tracking_link",
  "get_zone_url",
  "list_campaigns",
  "list_conversions",
  "list_payout_rules",
  "list_sub_labels",
  "list_targeting_rules",
  "list_targeting_types",
  "list_team",
  "list_zones",
  "remove_targeting_rule",
  "set_campaign_status",
  "set_payout_goal",
  "set_payout_rule",
  "set_sub_labels",
  "set_targeting_rule",
  "update_campaign",
  "update_zone",
  "whoami",
];

const READ_ONLY_ROSTER = [
  "get_campaign",
  "get_stats",
  "get_tracking_link",
  "get_zone_url",
  "list_campaigns",
  "list_conversions",
  "list_payout_rules",
  "list_sub_labels",
  "list_targeting_rules",
  "list_targeting_types",
  "list_team",
  "list_zones",
  "whoami",
];

async function listedToolNames(readOnly: boolean): Promise<string[]> {
  const config: Config = {
    baseUrl: "https://api.affset.com",
    docsBaseUrl: "https://affset.com",
    apiKey: "test-key",
    namespace: "test",
    requestTimeoutMs: 1_000,
    readOnly,
  };
  const server = new McpServer({ name: "roster-test", version: "0.0.0" });
  registerAffsetTools(server, config);
  const client = new Client({ name: "roster-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

describe("registerAffsetTools roster goldens", () => {
  it("registers exactly the golden full roster", async () => {
    assert.deepEqual(await listedToolNames(false), FULL_ROSTER);
  });

  it("registers exactly the golden read-only roster when readOnly is set", async () => {
    assert.deepEqual(await listedToolNames(true), READ_ONLY_ROSTER);
  });

  it("read-only roster is a strict subset of the full roster", () => {
    const full = new Set(FULL_ROSTER);
    for (const name of READ_ONLY_ROSTER) {
      assert.ok(full.has(name), `${name} missing from full roster`);
    }
    assert.ok(READ_ONLY_ROSTER.length < FULL_ROSTER.length);
  });

  it("reports metadata-only call outcomes without changing the tool result", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ company: "Fixture Co", timezone: "UTC" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const events: ToolCallEvent[] = [];
    const config: Config = {
      baseUrl: "https://api.affset.com",
      docsBaseUrl: "https://affset.com",
      apiKey: "test-key",
      namespace: "test",
      requestTimeoutMs: 1_000,
      readOnly: false,
    };
    const server = new McpServer({ name: "audit-test", version: "0.0.0" });
    registerAffsetTools(server, config, {
      onToolCall: (event) => {
        events.push(event);
        throw new Error("telemetry sink unavailable");
      },
    });
    const client = new Client({ name: "audit-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: "whoami", arguments: {} });
      assert.notEqual(result.isError, true);
      assert.match(JSON.stringify(result.content), /Fixture Co/);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.toolName, "whoami");
      assert.equal(events[0]?.status, "ok");
      assert.ok((events[0]?.durationMs ?? -1) >= 0);
    } finally {
      await client.close();
      await server.close();
      globalThis.fetch = realFetch;
    }
  });

  it("records error status when a tool returns isError without changing the result", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("nope", { status: 500 });

    const events: ToolCallEvent[] = [];
    const config: Config = {
      baseUrl: "https://api.affset.com",
      docsBaseUrl: "https://affset.com",
      apiKey: "test-key",
      namespace: "test",
      requestTimeoutMs: 1_000,
      readOnly: false,
    };
    const server = new McpServer({ name: "audit-error-test", version: "0.0.0" });
    registerAffsetTools(server, config, {
      onToolCall: (event) => {
        events.push(event);
      },
    });
    const client = new Client({ name: "audit-error-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "list_campaigns",
        arguments: { limit: 20, offset: 0, sort: "created_at", order: "desc" },
      });
      assert.equal(result.isError, true);
      assert.equal(events.length, 1);
      assert.equal(events[0]?.toolName, "list_campaigns");
      assert.equal(events[0]?.status, "error");
    } finally {
      await client.close();
      await server.close();
      globalThis.fetch = realFetch;
    }
  });

  it("rejects calls to mutating tools that were never registered in read-only mode", async () => {
    const config: Config = {
      baseUrl: "https://api.affset.com",
      docsBaseUrl: "https://affset.com",
      apiKey: "test-key",
      namespace: "test",
      requestTimeoutMs: 1_000,
      readOnly: true,
    };
    const server = new McpServer({ name: "readonly-call-test", version: "0.0.0" });
    registerAffsetTools(server, config);
    const client = new Client({ name: "readonly-call-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      let failedClosed = false;
      try {
        const result = await client.callTool({ name: "create_campaign", arguments: {} });
        failedClosed =
          result.isError === true && /not found|unknown tool/i.test(JSON.stringify(result.content));
      } catch (err) {
        failedClosed = /not found|unknown|Method not found/i.test(
          err instanceof Error ? err.message : String(err),
        );
      }
      assert.equal(failedClosed, true, "read-only mode must refuse create_campaign");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
