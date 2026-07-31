import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";

const BASE = {
  AFFSET_BASE_URL: "https://api.affset.com",
  AFFSET_API_KEY: "sk_test",
  AFFSET_NAMESPACE: "acme",
};

describe("loadConfig", () => {
  it("loads a valid https config", () => {
    const cfg = loadConfig(BASE);
    assert.equal(cfg.baseUrl, "https://api.affset.com");
    assert.equal(cfg.apiKey, "sk_test");
    assert.equal(cfg.namespace, "acme");
    assert.equal(cfg.requestTimeoutMs, 30_000);
    assert.equal(cfg.readOnly, false);
  });

  it("strips trailing slashes from the base URL", () => {
    const cfg = loadConfig({ ...BASE, AFFSET_BASE_URL: "https://api.affset.com///" });
    assert.equal(cfg.baseUrl, "https://api.affset.com");
  });

  it("allows http only on loopback", () => {
    const cfg = loadConfig({ ...BASE, AFFSET_BASE_URL: "http://127.0.0.1:8787" });
    assert.equal(cfg.baseUrl, "http://127.0.0.1:8787");
  });

  it("rejects cleartext http to a non-local host", () => {
    assert.throws(
      () => loadConfig({ ...BASE, AFFSET_BASE_URL: "http://api.affset.com" }),
      /must be https.*API key in cleartext/,
    );
  });

  it("rejects base URLs that are not bare origins", () => {
    assert.throws(
      () => loadConfig({ ...BASE, AFFSET_BASE_URL: "https://user:pass@api.affset.com" }),
      /embedded credentials/,
    );
    assert.throws(
      () => loadConfig({ ...BASE, AFFSET_BASE_URL: "https://api.affset.com/v1" }),
      /origin only/,
    );
    assert.throws(
      () => loadConfig({ ...BASE, AFFSET_BASE_URL: "https://api.affset.com?tenant=acme" }),
      /origin only/,
    );
  });

  it("defaults the docs URL to the marketing site", () => {
    assert.equal(loadConfig(BASE).docsBaseUrl, "https://affset.com");
  });

  it("accepts an AFFSET_DOCS_URL override and normalizes to origin", () => {
    const cfg = loadConfig({ ...BASE, AFFSET_DOCS_URL: "https://docs.staging.affset.com/" });
    assert.equal(cfg.docsBaseUrl, "https://docs.staging.affset.com");
  });

  it("allows http docs URLs only on loopback", () => {
    assert.equal(
      loadConfig({ ...BASE, AFFSET_DOCS_URL: "http://localhost:8788" }).docsBaseUrl,
      "http://localhost:8788",
    );
    assert.throws(
      () => loadConfig({ ...BASE, AFFSET_DOCS_URL: "http://affset.com" }),
      /AFFSET_DOCS_URL must be https/,
    );
  });

  it("rejects docs URLs that are not bare origins", () => {
    assert.throws(
      () => loadConfig({ ...BASE, AFFSET_DOCS_URL: "https://affset.com/docs" }),
      /AFFSET_DOCS_URL must be an origin only/,
    );
  });

  it("rejects missing required env vars with a combined message", () => {
    assert.throws(() => loadConfig({}), /AFFSET_BASE_URL, AFFSET_API_KEY, AFFSET_NAMESPACE/);
  });

  it("rejects invalid namespaces (length / charset / consecutive hyphens)", () => {
    assert.throws(() => loadConfig({ ...BASE, AFFSET_NAMESPACE: "ab" }), /3–63/);
    assert.throws(() => loadConfig({ ...BASE, AFFSET_NAMESPACE: "Acme" }), /lowercase/);
    assert.throws(() => loadConfig({ ...BASE, AFFSET_NAMESPACE: "acme--co" }), /consecutive/);
    assert.throws(() => loadConfig({ ...BASE, AFFSET_NAMESPACE: "-acme" }), /lowercase/);
  });

  it("parses AFFSET_READ_ONLY truthy values", () => {
    assert.equal(loadConfig({ ...BASE, AFFSET_READ_ONLY: "true" }).readOnly, true);
    assert.equal(loadConfig({ ...BASE, AFFSET_READ_ONLY: "1" }).readOnly, true);
    assert.equal(loadConfig({ ...BASE, AFFSET_READ_ONLY: "yes" }).readOnly, true);
    assert.equal(loadConfig({ ...BASE, AFFSET_READ_ONLY: "false" }).readOnly, false);
  });

  it("rejects unrecognized AFFSET_READ_ONLY values instead of enabling writes", () => {
    assert.throws(
      () => loadConfig({ ...BASE, AFFSET_READ_ONLY: "ture" }),
      /must be a boolean value/,
    );
  });

  it("rejects invalid request timeouts", () => {
    assert.throws(() => loadConfig({ ...BASE, AFFSET_REQUEST_TIMEOUT_MS: "500" }), /between/);
    assert.throws(() => loadConfig({ ...BASE, AFFSET_REQUEST_TIMEOUT_MS: "300001" }), /between/);
    assert.throws(() => loadConfig({ ...BASE, AFFSET_REQUEST_TIMEOUT_MS: "1500.5" }), /integer/);
  });
});
