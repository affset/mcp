import type { Config } from "./runtimeConfig.js";
import {
  MAX_REQUEST_TIMEOUT_MS,
  MIN_REQUEST_TIMEOUT_MS,
  parseOriginUrl,
  validateApiKey,
  validateNamespace,
} from "./runtimeConfig.js";

export type { Config } from "./runtimeConfig.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/** Where the docs feeds live when AFFSET_DOCS_URL is not set. */
const DEFAULT_DOCS_URL = "https://affset.com";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

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

  validateNamespace(namespace!, "AFFSET_NAMESPACE");
  const parsedApiKey = validateApiKey(apiKey!, "AFFSET_API_KEY");

  // Plain http on AFFSET_BASE_URL sends the Bearer API key in cleartext; the
  // helper refuses it for non-loopback hosts.
  const parsed = parseOriginUrl(baseUrl!, "AFFSET_BASE_URL", true);

  // Optional — the docs feeds are public, so this only sets where to fetch them.
  const docsRaw = env.AFFSET_DOCS_URL?.trim();
  const docsBaseUrl = parseOriginUrl(docsRaw || DEFAULT_DOCS_URL, "AFFSET_DOCS_URL").origin;

  const timeoutRaw = env.AFFSET_REQUEST_TIMEOUT_MS?.trim();
  let requestTimeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw) {
    const n = Number(timeoutRaw);
    if (!Number.isSafeInteger(n) || n < MIN_REQUEST_TIMEOUT_MS || n > MAX_REQUEST_TIMEOUT_MS) {
      throw new Error(
        `AFFSET_REQUEST_TIMEOUT_MS must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS}.`,
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
    apiKey: parsedApiKey,
    namespace: namespace!,
    requestTimeoutMs,
    readOnly,
  };
}
