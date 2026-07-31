import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
});
