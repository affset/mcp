import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Config } from "./runtimeConfig.js";
import { normalizeRuntimeConfig } from "./runtimeConfig.js";

const CONFIG: Config = {
  baseUrl: "https://api.affset.com",
  docsBaseUrl: "https://affset.com",
  apiKey: "sk_test",
  namespace: "acme",
  requestTimeoutMs: 30_000,
  readOnly: true,
};

describe("normalizeRuntimeConfig", () => {
  it("normalizes origins and surrounding whitespace without mutating the caller", () => {
    const input = {
      ...CONFIG,
      baseUrl: " https://api.affset.com/// ",
      docsBaseUrl: "https://affset.com/",
      namespace: " acme ",
    };

    const normalized = normalizeRuntimeConfig(input);

    assert.equal(normalized.baseUrl, "https://api.affset.com");
    assert.equal(normalized.docsBaseUrl, "https://affset.com");
    assert.equal(normalized.namespace, "acme");
    assert.equal(input.baseUrl, " https://api.affset.com/// ");
  });

  it("rejects a remote cleartext API origin before a bearer key can be used", () => {
    assert.throws(
      () => normalizeRuntimeConfig({ ...CONFIG, baseUrl: "http://api.affset.com" }),
      /must be https.*API key in cleartext/,
    );
  });

  it("allows cleartext origins only for local development", () => {
    const normalized = normalizeRuntimeConfig({
      ...CONFIG,
      baseUrl: "http://127.0.0.1:8787/",
      docsBaseUrl: "http://docs.localhost:3000/",
    });
    assert.equal(normalized.baseUrl, "http://127.0.0.1:8787");
    assert.equal(normalized.docsBaseUrl, "http://docs.localhost:3000");
  });

  it("rejects malformed values instead of weakening runtime boundaries", () => {
    assert.throws(
      () => normalizeRuntimeConfig({ ...CONFIG, baseUrl: "https://api.affset.com/v1" }),
      /origin only/,
    );
    assert.throws(
      () => normalizeRuntimeConfig({ ...CONFIG, namespace: "other--tenant" }),
      /consecutive/,
    );
    assert.throws(
      () => normalizeRuntimeConfig({ ...CONFIG, apiKey: "line1\nline2" }),
      /line breaks/,
    );
    assert.throws(
      () => normalizeRuntimeConfig({ ...CONFIG, requestTimeoutMs: 999 }),
      /between 1000 and 300000/,
    );
    assert.throws(
      () => normalizeRuntimeConfig({ ...CONFIG, readOnly: undefined as unknown as boolean }),
      /must be a boolean/,
    );
  });
});
