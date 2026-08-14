import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AffsetApiError, AffsetClient } from "./client.js";
import type { Config } from "./config.js";

const config: Config = {
  baseUrl: "https://api.affset.com",
  docsBaseUrl: "https://affset.com",
  apiKey: "sk_test",
  namespace: "acme",
  requestTimeoutMs: 5_000,
  readOnly: false,
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("AffsetClient path hardening", () => {
  it("rejects absolute http(s) paths before fetch", async () => {
    const client = new AffsetClient(config);
    await assert.rejects(
      () => client.get("https://evil.example/steal"),
      (err: unknown) => {
        assert.ok(err instanceof AffsetApiError);
        assert.match(err.message, /non-relative/);
        return true;
      },
    );
  });

  it("rejects protocol-relative paths before fetch", async () => {
    const client = new AffsetClient(config);
    await assert.rejects(
      () => client.get("//evil.example/steal"),
      (err: unknown) => {
        assert.ok(err instanceof AffsetApiError);
        assert.match(err.message, /non-relative/);
        return true;
      },
    );
  });

  it("rejects backslash-normalized cross-origin paths before fetch", async () => {
    const client = new AffsetClient(config);
    await assert.rejects(
      () => client.get("/\\evil.example/steal"),
      (err: unknown) => {
        assert.ok(err instanceof AffsetApiError);
        assert.match(err.message, /cross-origin/);
        return true;
      },
    );
  });

  it("rejects an oversized API response from Content-Length before reading it", async () => {
    globalThis.fetch = async () =>
      new Response("small fixture", {
        status: 200,
        headers: { "Content-Length": "5000001" },
      });

    const client = new AffsetClient(config);
    await assert.rejects(() => client.get("/api/stats"), /Response too large.*declared/);
  });

  it("stops reading an oversized streamed API response without Content-Length", async () => {
    const chunk = new Uint8Array(2_500_001);
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk);
            controller.enqueue(chunk);
            controller.close();
          },
        }),
        { status: 200 },
      );

    const client = new AffsetClient(config);
    await assert.rejects(() => client.get("/api/stats"), /Response too large.*streaming/);
  });
});
