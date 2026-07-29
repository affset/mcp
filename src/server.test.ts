import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "./config.js";
import { createServer } from "./server.js";

async function listedTools(readOnly: boolean) {
  const config: Config = {
    baseUrl: "https://api.affset.com",
    apiKey: "test-key",
    namespace: "test",
    requestTimeoutMs: 1_000,
    readOnly,
  };
  const server = createServer(config);
  const client = new Client({ name: "affset-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

describe("server tool registration", () => {
  it("removes mutation tools in read-only mode", async () => {
    const tools = await listedTools(true);
    const names = new Set(tools.map((tool) => tool.name));

    assert.ok(names.has("whoami"));
    assert.ok(names.has("get_stats"));
    assert.ok(names.has("list_conversions"));
    assert.ok(names.has("list_team"));
    assert.equal(names.has("create_campaign"), false);
    assert.equal(names.has("create_zone"), false);
    assert.equal(names.has("update_campaign"), false);
    assert.equal(names.has("create_team_member"), false);
  });

  it("publishes confirmation defaults for all three create tools", async () => {
    const tools = await listedTools(false);
    for (const name of ["create_campaign", "create_zone", "create_team_member"]) {
      const tool = tools.find((candidate) => candidate.name === name);
      assert.ok(tool, `${name} should be registered`);
      const confirm = tool.inputSchema.properties?.confirm as { default?: unknown } | undefined;
      assert.equal(confirm?.default, false);
    }
  });
});
