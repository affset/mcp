/**
 * Runtime configuration, loaded from environment variables.
 *
 * One MCP server instance serves exactly one affset tenant, so the credentials
 * live in the process environment (set by the MCP client config), never in code.
 */
export interface Config {
  /** Base URL of the affset API, with any trailing slash stripped. */
  baseUrl: string;
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

const TRUTHY = new Set(["1", "true", "yes", "on"]);

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

  const normalized = baseUrl!.replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`AFFSET_BASE_URL is not a valid URL: ${baseUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`AFFSET_BASE_URL must be http(s), got ${parsed.protocol}`);
  }
  // Plain http sends the Bearer API key in cleartext. Only loopback (local dev /
  // wrangler dev) is exempt — anything else must be https.
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `AFFSET_BASE_URL must be https for a non-local host (got http://${parsed.hostname}) — ` +
        `plain http would send the API key in cleartext.`,
    );
  }

  const timeoutRaw = env.AFFSET_REQUEST_TIMEOUT_MS?.trim();
  let requestTimeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw) {
    const n = Number(timeoutRaw);
    if (!Number.isFinite(n) || n < 1000) {
      throw new Error("AFFSET_REQUEST_TIMEOUT_MS must be a number >= 1000.");
    }
    requestTimeoutMs = Math.floor(n);
  }

  const readOnly = TRUTHY.has((env.AFFSET_READ_ONLY ?? "").trim().toLowerCase());

  return {
    baseUrl: normalized,
    apiKey: apiKey!,
    namespace: namespace!,
    requestTimeoutMs,
    readOnly,
  };
}
