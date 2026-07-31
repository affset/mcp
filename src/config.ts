/**
 * Runtime configuration, loaded from environment variables.
 *
 * One MCP server instance serves exactly one affset tenant, so the credentials
 * live in the process environment (set by the MCP client config), never in code.
 */
export interface Config {
  /** Base URL of the affset API, with any trailing slash stripped. */
  baseUrl: string;
  /**
   * Origin the docs feeds (`/api-reference.md`, `/api-reference.json`) are
   * fetched from for the MCP documentation resources. Defaults to the affset
   * marketing site; overridable with AFFSET_DOCS_URL. Distinct from `baseUrl`
   * because the docs live on the public site, not the tenant API host, and are
   * fetched with no credentials.
   */
  docsBaseUrl: string;
  /** Tenant API key sent as `Authorization: Bearer <key>`. */
  apiKey: string;
  /** Tenant namespace sent as `X-Namespace`. */
  namespace: string;
  /** Per-request timeout in ms (AbortSignal). */
  requestTimeoutMs: number;
  /** When true, only read-only tools are registered — see AFFSET_READ_ONLY. */
  readOnly: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

/** Where the docs feeds live when AFFSET_DOCS_URL is not set. */
const DEFAULT_DOCS_URL = "https://affset.com";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/**
 * Same rules as lite-adserver signup: lowercase alnum + hyphens, 3–63 chars,
 * no leading/trailing hyphen, no consecutive hyphens. Keeps whoami's
 * `https://{namespace}.affset.com` URL from embedding attacker-chosen junk if
 * someone pastes a weird AFFSET_NAMESPACE into their MCP client config.
 */
const NAMESPACE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Loopback hosts allowed to stay on plain http — everything else must be https. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Parse an origin-only URL (scheme + host + optional port, no path/query/creds)
 * and return it, or throw an actionable error naming `varName`. Plain http is
 * refused for non-loopback hosts. Shared by AFFSET_BASE_URL (sends the API key)
 * and AFFSET_DOCS_URL (fetched anonymously) so both obey identical rules.
 */
function parseOriginUrl(raw: string, varName: string): URL {
  const normalized = raw.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${varName} is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${varName} must be http(s), got ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${varName} must not contain embedded credentials.`);
  }
  if ((parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new Error(
      `${varName} must be an origin only (scheme, host, and optional port; no path, query, or fragment).`,
    );
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    // AFFSET_BASE_URL carries the Bearer API key — spell out why http is refused.
    const cleartextHint =
      varName === "AFFSET_BASE_URL" ? " — plain http would send the API key in cleartext" : "";
    throw new Error(
      `${varName} must be https for a non-local host (got http://${parsed.hostname})${cleartextHint}.`,
    );
  }
  return parsed;
}

function namespaceError(namespace: string): string | null {
  if (namespace.length < 3 || namespace.length > 63) {
    return "AFFSET_NAMESPACE must be 3–63 characters.";
  }
  if (!NAMESPACE_RE.test(namespace) || namespace.includes("--")) {
    return (
      "AFFSET_NAMESPACE must be lowercase letters, numbers, and hyphens only " +
      "(no leading/trailing or consecutive hyphens)."
    );
  }
  return null;
}

/**
 * Read and validate config from the environment. Throws with an actionable
 * message listing every missing variable — surfaced to the user at startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = env.AFFSET_BASE_URL?.trim();
  const apiKey = env.AFFSET_API_KEY?.trim();
  const namespace = env.AFFSET_NAMESPACE?.trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push("AFFSET_BASE_URL");
  if (!apiKey) missing.push("AFFSET_API_KEY");
  if (!namespace) missing.push("AFFSET_NAMESPACE");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `See .env.example for the expected values.`,
    );
  }

  const nsErr = namespaceError(namespace!);
  if (nsErr) throw new Error(nsErr);

  // Plain http on AFFSET_BASE_URL sends the Bearer API key in cleartext; the
  // helper refuses it for non-loopback hosts.
  const parsed = parseOriginUrl(baseUrl!, "AFFSET_BASE_URL");

  // Optional — the docs feeds are public, so this only sets where to fetch them.
  const docsRaw = env.AFFSET_DOCS_URL?.trim();
  const docsBaseUrl = parseOriginUrl(docsRaw || DEFAULT_DOCS_URL, "AFFSET_DOCS_URL").origin;

  const timeoutRaw = env.AFFSET_REQUEST_TIMEOUT_MS?.trim();
  let requestTimeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw) {
    const n = Number(timeoutRaw);
    if (!Number.isSafeInteger(n) || n < 1000 || n > MAX_TIMEOUT_MS) {
      throw new Error(
        `AFFSET_REQUEST_TIMEOUT_MS must be an integer between 1000 and ${MAX_TIMEOUT_MS}.`,
      );
    }
    requestTimeoutMs = n;
  }

  const readOnlyRaw = (env.AFFSET_READ_ONLY ?? "").trim().toLowerCase();
  let readOnly = false;
  if (readOnlyRaw) {
    if (TRUTHY.has(readOnlyRaw)) readOnly = true;
    else if (!FALSY.has(readOnlyRaw)) {
      throw new Error(
        "AFFSET_READ_ONLY must be a boolean value: true/false, 1/0, yes/no, or on/off.",
      );
    }
  }

  return {
    baseUrl: parsed.origin,
    docsBaseUrl,
    apiKey: apiKey!,
    namespace: namespace!,
    requestTimeoutMs,
    readOnly,
  };
}
