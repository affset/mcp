import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Config } from "./config.js";
import { DOCS_FEEDS, DocsFetchError, fetchDocsFeed } from "./docs.js";

const CONFIG: Config = {
  baseUrl: "https://api.affset.com",
  docsBaseUrl: "https://affset.com",
  apiKey: "sk_test",
  namespace: "acme",
  requestTimeoutMs: 1_000,
  readOnly: false,
};

const MARKDOWN = "# affset API reference\n\nEndpoints and auth.\n";
const JSON_BODY = JSON.stringify({ schema_version: 1, base_url: "https://api.affset.com" });

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchDocsFeed", () => {
  it("fetches the feed from docsBaseUrl and returns its text, sending no auth headers", async () => {
    let seenUrl = "";
    let seenHeaders: Headers | undefined;
    let seenRedirect: RequestRedirect | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenHeaders = new Headers(init?.headers);
      seenRedirect = init?.redirect;
      return new Response(MARKDOWN, {
        status: 200,
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }) as typeof fetch;

    const text = await fetchDocsFeed(CONFIG, DOCS_FEEDS.markdown);

    assert.equal(text, MARKDOWN);
    assert.equal(seenUrl, "https://affset.com/api-reference.md");
    assert.equal(seenHeaders?.has("authorization"), false);
    assert.equal(seenHeaders?.has("x-namespace"), false);
    assert.equal(seenRedirect, "manual");
  });

  it("accepts a valid JSON feed", async () => {
    globalThis.fetch = async () =>
      new Response(JSON_BODY, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const text = await fetchDocsFeed(CONFIG, DOCS_FEEDS.json);
    assert.equal(text, JSON_BODY);
  });

  it("throws DocsFetchError on a non-2xx response", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 404 });
    await assert.rejects(
      () => fetchDocsFeed(CONFIG, DOCS_FEEDS.json),
      (err: unknown) => err instanceof DocsFetchError && /HTTP 404/.test(err.message),
    );
  });

  it("rejects SPA HTML fallbacks even when status is 200", async () => {
    globalThis.fetch = async () =>
      new Response("<!doctype html><html><body>app</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    await assert.rejects(
      () => fetchDocsFeed(CONFIG, DOCS_FEEDS.markdown),
      (err: unknown) => err instanceof DocsFetchError && /HTML/.test(err.message),
    );
  });

  it("rejects HTML bodies that claim a non-HTML content type", async () => {
    globalThis.fetch = async () =>
      new Response("<html><body>spa</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      });
    await assert.rejects(
      () => fetchDocsFeed(CONFIG, DOCS_FEEDS.markdown),
      (err: unknown) => err instanceof DocsFetchError && /HTML document/.test(err.message),
    );
  });

  it("rejects invalid JSON for the JSON feed", async () => {
    globalThis.fetch = async () =>
      new Response("# not json\n", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    await assert.rejects(
      () => fetchDocsFeed(CONFIG, DOCS_FEEDS.json),
      (err: unknown) => err instanceof DocsFetchError && /not valid JSON/.test(err.message),
    );
  });

  it("rejects redirects instead of following them", async () => {
    globalThis.fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://evil.example/api-reference.md" },
      });
    await assert.rejects(
      () => fetchDocsFeed(CONFIG, DOCS_FEEDS.markdown),
      (err: unknown) => err instanceof DocsFetchError && /redirect/.test(err.message),
    );
  });

  it("maps an aborted fetch to a timeout DocsFetchError", async () => {
    globalThis.fetch = async () => {
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    };
    await assert.rejects(
      () => fetchDocsFeed(CONFIG, DOCS_FEEDS.markdown),
      (err: unknown) => err instanceof DocsFetchError && /Timed out/.test(err.message),
    );
  });

  it("rejects an oversized body via Content-Length before reading", async () => {
    globalThis.fetch = async () =>
      new Response("tiny", {
        status: 200,
        headers: {
          "Content-Type": "text/markdown",
          "Content-Length": String(2_000_001),
        },
      });
    await assert.rejects(
      () => fetchDocsFeed(CONFIG, DOCS_FEEDS.markdown),
      (err: unknown) => err instanceof DocsFetchError && /Content-Length/.test(err.message),
    );
  });

  it("rejects an oversized streamed body without Content-Length", async () => {
    globalThis.fetch = async () =>
      new Response("x".repeat(2_000_001), {
        status: 200,
        headers: { "Content-Type": "text/markdown" },
      });
    await assert.rejects(
      () => fetchDocsFeed(CONFIG, DOCS_FEEDS.markdown),
      (err: unknown) => err instanceof DocsFetchError && /exceeded the/.test(err.message),
    );
  });
});
