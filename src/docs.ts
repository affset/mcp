import type { Config } from "./config.js";

/**
 * Fetches the affset documentation feeds that back the MCP documentation
 * resources. These are static files published by the marketing site
 * (see lite-adserver-home/scripts/generate-docs.mjs), generated from the same
 * source as the /docs page, so the resource content never drifts from the docs.
 *
 * Fetched at read time — the resource is always the currently published docs,
 * not a snapshot pinned to this package version. Unlike the tenant API client,
 * this sends NO credentials: the docs are public, and the docs origin
 * (AFFSET_DOCS_URL) is deliberately not the API host that holds the API key.
 */

/** One published feed: the URI path segment and how it's served. */
export interface DocsFeed {
  /** Trailing path on the docs origin, e.g. "api-reference.md". */
  file: string;
  mimeType: string;
}

export const DOCS_FEEDS = {
  markdown: { file: "api-reference.md", mimeType: "text/markdown" },
  json: { file: "api-reference.json", mimeType: "application/json" },
} as const satisfies Record<string, DocsFeed>;

/** A hostile or misconfigured origin shouldn't be able to flood model context. */
const MAX_DOCS_BYTES = 2_000_000;

/** Thrown when a docs feed can't be fetched or looks wrong. */
export class DocsFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsFetchError";
  }
}

/**
 * Read a response body, aborting once it exceeds `maxBytes`. Prefers
 * Content-Length when present so oversized bodies never enter memory.
 */
async function readBodyWithLimit(res: Response, maxBytes: number, url: string): Promise<string> {
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new DocsFetchError(
        `Docs response from ${url} declares Content-Length ${declared}, over the ${maxBytes}-byte limit.`,
      );
    }
  }

  if (!res.body) {
    return "";
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new DocsFetchError(
          `Docs response from ${url} exceeded the ${maxBytes}-byte limit while streaming.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString("utf8");
}

/** SPA catch-alls often return 200 HTML for missing static feeds — refuse those. */
function assertNotHtmlShell(text: string, contentType: string | null, url: string): void {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml")) {
    throw new DocsFetchError(
      `Docs fetch for ${url} returned HTML (${contentType ?? "unknown type"}) instead of the documentation feed. ` +
        `Is the feed deployed at that origin?`,
    );
  }
  const head = text.slice(0, 256).trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    throw new DocsFetchError(
      `Docs fetch for ${url} returned an HTML document instead of the documentation feed. ` +
        `Is the feed deployed at that origin?`,
    );
  }
}

function validateFeedBody(text: string, feed: DocsFeed, url: string): void {
  if (text.length === 0) {
    throw new DocsFetchError(`Docs response from ${url} was empty.`);
  }

  if (feed.mimeType === "application/json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new DocsFetchError(
        `Docs response from ${url} is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new DocsFetchError(`Docs JSON from ${url} must be a top-level object.`);
    }
    return;
  }

  // Markdown feed: require a heading so we don't accept arbitrary plain text.
  if (!/^#\s+\S/m.test(text.slice(0, 4_096))) {
    throw new DocsFetchError(
      `Docs Markdown from ${url} does not look like the API reference (missing a top-level heading).`,
    );
  }
}

/**
 * Fetch one docs feed and return its text. Throws {@link DocsFetchError} with an
 * actionable message on any network error, non-2xx status, HTML SPA fallback,
 * invalid body, or oversized response — the MCP layer surfaces that to the
 * caller as the resource read failure.
 */
export async function fetchDocsFeed(config: Config, feed: DocsFeed): Promise<string> {
  const url = `${config.docsBaseUrl}/${feed.file}`;

  let res: Response;
  try {
    res = await fetch(url, {
      // No Authorization / X-Namespace: the docs are public and this is a
      // different origin from the tenant API. Accept nudges the CDN toward the
      // right representation without depending on it.
      headers: { Accept: feed.mimeType },
      // Don't follow redirects to a different host — a misconfigured docs
      // origin shouldn't silently pull content from elsewhere.
      redirect: "manual",
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new DocsFetchError(
        `Timed out after ${config.requestTimeoutMs}ms fetching docs from ${url}`,
      );
    }
    throw new DocsFetchError(
      `Could not reach docs at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") ?? "(no Location header)";
    throw new DocsFetchError(
      `Docs fetch for ${url} returned HTTP ${res.status} redirect to ${location}. ` +
        `AFFSET_DOCS_URL must point at the origin that serves the feeds directly.`,
    );
  }

  if (!res.ok) {
    throw new DocsFetchError(`Docs fetch for ${url} returned HTTP ${res.status}.`);
  }

  const text = await readBodyWithLimit(res, MAX_DOCS_BYTES, url);
  assertNotHtmlShell(text, res.headers.get("content-type"), url);
  validateFeedBody(text, feed, url);
  return text;
}
