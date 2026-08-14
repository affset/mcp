/**
 * Bound upstream memory use before parsing or rendering into model context.
 * Runtime-agnostic (no `node:` imports) so the tenant API client and docs
 * fetcher can share it on Workers.
 */

export class ResponseTooLargeError extends Error {
  readonly name = "ResponseTooLargeError";

  constructor(
    readonly kind: "declared" | "streaming",
    readonly limit: number,
    readonly size?: number,
  ) {
    super(
      kind === "declared"
        ? `declared ${size} bytes (limit ${limit})`
        : `exceeded ${limit} bytes while streaming`,
    );
  }
}

/**
 * Read a response body as UTF-8, aborting once it exceeds `maxBytes`. Prefers
 * Content-Length when present so oversized bodies never enter memory.
 */
export async function readResponseText(res: Response, maxBytes: number): Promise<string> {
  const contentLength = res.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      if (res.body) await res.body.cancel().catch(() => undefined);
      throw new ResponseTooLargeError("declared", maxBytes, declared);
    }
  }

  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseTooLargeError("streaming", maxBytes, total);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // cancel() already released the lock; a throw here would mask the
      // size-limit error the caller needs to surface.
    }
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
