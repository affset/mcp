import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Config } from "./config.js";
import { createServer } from "./server.js";

async function listedTools(readOnly: boolean) {
  const config: Config = {
    baseUrl: "https://api.affset.com",
    docsBaseUrl: "https://affset.com",
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

async function withClient<T>(readOnly: boolean, fn: (client: Client) => Promise<T>): Promise<T> {
  const config: Config = {
    baseUrl: "https://api.affset.com",
    docsBaseUrl: "https://affset.com",
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
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("server documentation resources", () => {
  it("exposes both docs resources, even in read-only mode", async () => {
    const resources = await withClient(
      true,
      async (client) => (await client.listResources()).resources,
    );
    const uris = new Set(resources.map((resource) => resource.uri));
    assert.ok(uris.has("affset://docs/api-reference"));
    assert.ok(uris.has("affset://docs/api-reference.json"));
  });

  it("reads a docs resource by fetching the published feed", async () => {
    const realFetch = globalThis.fetch;
    let seenUrl = "";
    const body = "# affset API reference\n\nAuth and endpoints.\n";
    globalThis.fetch = (async (url: string | URL) => {
      seenUrl = String(url);
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }) as typeof fetch;
    try {
      const result = await withClient(false, (client) =>
        client.readResource({ uri: "affset://docs/api-reference" }),
      );
      assert.equal(seenUrl, "https://affset.com/api-reference.md");
      const content = result.contents[0];
      assert.ok(content && "text" in content, "resource should return text content");
      assert.equal(content.mimeType, "text/markdown");
      assert.equal(content.text, body);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("surfaces a fetch failure when the docs origin returns an HTML SPA shell", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("<!doctype html><html><body>app</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    try {
      await assert.rejects(
        () =>
          withClient(false, (client) =>
            client.readResource({ uri: "affset://docs/api-reference" }),
          ),
        /HTML|docs|feed/i,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("server tool registration", () => {
  it("does not register mutation tools in read-only mode", async () => {
    const tools = await listedTools(true);
    const names = new Set(tools.map((tool) => tool.name));

    assert.ok(names.has("whoami"));
    assert.ok(names.has("get_stats"));
    assert.ok(names.has("get_campaign"));
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
