/**
 * Runtime configuration shared by the stdio entrypoint and library consumers.
 *
 * Keep this module free of Node-specific globals and types: it is part of the
 * public `@affset/mcp/core` declaration graph and is consumed by Workers.
 */
export interface Config {
  /** Base URL of the affset API. Normalized to a bare origin. */
  baseUrl: string;
  /** Public origin that serves the documentation feeds. */
  docsBaseUrl: string;
  /** Tenant API key sent as `Authorization: Bearer <key>`. */
  apiKey: string;
  /** Tenant namespace sent as `X-Namespace`. */
  namespace: string;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number;
  /** When true, only tools annotated as read-only are registered. */
  readOnly: boolean;
}

export const MIN_REQUEST_TIMEOUT_MS = 1_000;
export const MAX_REQUEST_TIMEOUT_MS = 300_000;

const NAMESPACE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

/** Parse and normalize an HTTP(S) origin, refusing cleartext remote hosts. */
export function parseOriginUrl(raw: string, name: string, carriesApiKey = false): URL {
  const normalized = raw.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${name} is not a valid URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be http(s), got ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain embedded credentials.`);
  }
  if ((parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new Error(
      `${name} must be an origin only (scheme, host, and optional port; no path, query, or fragment).`,
    );
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    const cleartextHint = carriesApiKey ? " — plain http would send the API key in cleartext" : "";
    throw new Error(
      `${name} must be https for a non-local host (got http://${parsed.hostname})${cleartextHint}.`,
    );
  }

  return parsed;
}

/** Validate a namespace using the same rules as tenant signup. */
export function validateNamespace(namespace: string, name: string): void {
  if (namespace.length < 3 || namespace.length > 63) {
    throw new Error(`${name} must be 3–63 characters.`);
  }
  if (!NAMESPACE_RE.test(namespace) || namespace.includes("--")) {
    throw new Error(
      `${name} must be lowercase letters, numbers, and hyphens only ` +
        "(no leading/trailing or consecutive hyphens).",
    );
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

/** Reject empty keys and CR/LF so a value cannot split HTTP headers. */
export function validateApiKey(value: unknown, name: string): string {
  const apiKey = requiredString(value, name);
  if (/\r|\n/.test(apiKey)) {
    throw new Error(`${name} must not contain line breaks.`);
  }
  return apiKey;
}

/**
 * Validate and normalize config supplied through the public library API.
 *
 * TypeScript types are not a runtime security boundary. Hosted transports can
 * source these values from deployment config or grant records, so fail before
 * registering tools if a malformed value could leak a bearer key or silently
 * disable the read-only boundary.
 */
export function normalizeRuntimeConfig(config: Config): Config {
  if (config === null || typeof config !== "object") {
    throw new Error("config must be an object.");
  }

  const baseUrl = parseOriginUrl(
    requiredString(config.baseUrl, "config.baseUrl"),
    "config.baseUrl",
    true,
  ).origin;
  const docsBaseUrl = parseOriginUrl(
    requiredString(config.docsBaseUrl, "config.docsBaseUrl"),
    "config.docsBaseUrl",
  ).origin;
  const apiKey = validateApiKey(config.apiKey, "config.apiKey");

  const namespace = requiredString(config.namespace, "config.namespace");
  validateNamespace(namespace, "config.namespace");

  if (
    !Number.isSafeInteger(config.requestTimeoutMs) ||
    config.requestTimeoutMs < MIN_REQUEST_TIMEOUT_MS ||
    config.requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new Error(
      `config.requestTimeoutMs must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS}.`,
    );
  }
  if (typeof config.readOnly !== "boolean") {
    throw new Error("config.readOnly must be a boolean.");
  }

  return {
    baseUrl,
    docsBaseUrl,
    apiKey,
    namespace,
    requestTimeoutMs: config.requestTimeoutMs,
    readOnly: config.readOnly,
  };
}
