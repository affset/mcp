import { readResponseText, ResponseTooLargeError } from "./lib/readBody.js";
import { normalizeRuntimeConfig, type Config } from "./runtimeConfig.js";

/** Thrown when the affset API returns a non-2xx response. */
export class AffsetApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Parsed JSON body when present (e.g. plan-limit details). */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "AffsetApiError";
  }
}

type Query = Record<string, string | number | undefined>;

/** Bound upstream memory use before JSON parsing or rendering into model context. */
const MAX_API_RESPONSE_BYTES = 5_000_000;

/**
 * Thin typed HTTP client over the affset tenant API. Injects the Bearer token
 * and `X-Namespace` header on every request and normalises error handling.
 */
export class AffsetClient {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = normalizeRuntimeConfig(config);
  }

  /** Resolved once per process; the tenant timezone changes about never. */
  private tenantTimezone?: Promise<string>;

  /**
   * The tenant's timezone (IANA name). Date ranges must be resolved in it, not
   * in the host machine's zone, so that a requested window lines up with the
   * date buckets `/api/stats?group_by=date` returns.
   *
   * Falls back to UTC if the setting cannot be read — a stats query with a
   * slightly-off window beats failing the whole call.
   */
  async getTenantTimezone(): Promise<string> {
    try {
      return await this.readTenantTimezone();
    } catch {
      return "UTC";
    }
  }

  /**
   * Tenant timezone for a write whose meaning depends on local midnight. Unlike
   * stats reads, silently falling back to UTC here could change a schedule, so
   * callers get the underlying API error and must stop the mutation.
   */
  async getRequiredTenantTimezone(): Promise<string> {
    return this.readTenantTimezone();
  }

  private readTenantTimezone(): Promise<string> {
    this.tenantTimezone ??= this.get<{ timezone?: string }>("/api/tenant").then(
      (settings) => settings.timezone?.trim() || "UTC",
    );
    return this.tenantTimezone;
  }

  async get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  async delete<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>("DELETE", path, { query });
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    // Defense in depth: every call site today passes a hardcoded `/api/...`
    // path, but `new URL(path, base)` would quietly redirect to an absolute or
    // protocol-relative URL if a future tool ever interpolated user input into
    // `path`. Refuse anything that isn't a same-origin relative path.
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new AffsetApiError(
        0,
        `Refusing non-relative API path (must start with a single /): ${path}`,
      );
    }
    const url = new URL(path, `${this.config.baseUrl}/`);
    if (url.origin !== new URL(this.config.baseUrl).origin) {
      throw new AffsetApiError(0, `Refusing cross-origin API path: ${path}`);
    }
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "X-Namespace": this.config.namespace,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new AffsetApiError(
          0,
          `Timed out after ${this.config.requestTimeoutMs}ms calling ${method} ${path}`,
        );
      }
      throw new AffsetApiError(
        0,
        `Network error calling ${method} ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let text: string;
    try {
      text = await readResponseText(res, MAX_API_RESPONSE_BYTES);
    } catch (err) {
      if (err instanceof ResponseTooLargeError) {
        throw new AffsetApiError(
          res.ok ? 0 : res.status,
          `Response too large calling ${method} ${path}: ${err.message}.`,
        );
      }
      throw err;
    }
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const apiMessage = extractApiError(data) ?? (res.statusText || `HTTP ${res.status}`);
      throw new AffsetApiError(res.status, apiMessage, data);
    }

    return data as T;
  }
}

function extractApiError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  if ("error" in data && data.error != null) {
    return String(data.error);
  }
  if ("message" in data && data.message != null) {
    return String(data.message);
  }
  return undefined;
}
