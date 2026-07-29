import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError } from "../client.js";

/** Build a successful text tool result. */
export function textResult(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }] };
}

/** Build an error tool result (isError: true). */
export function errorResult(err: unknown): CallToolResult {
  return { content: [{ type: "text", text: formatError(err) }], isError: true };
}

/** Build an error tool result from a plain string. */
export function textError(body: string): CallToolResult {
  return { content: [{ type: "text", text: body }], isError: true };
}

function formatError(err: unknown): string {
  if (!(err instanceof AffsetApiError)) {
    return err instanceof Error ? err.message : String(err);
  }

  let message = `affset API error (${err.status}): ${err.message}`;
  const body = err.body;
  if (body && typeof body === "object" && "code" in body) {
    const b = body as {
      code?: unknown;
      dimension?: unknown;
      limit?: unknown;
      current?: unknown;
      min_plan_id?: unknown;
      plan_id?: unknown;
    };
    if (b.code === "PLAN_LIMIT_REACHED" || b.code === "SUBSCRIPTION_REQUIRED") {
      const bits = [
        `code=${String(b.code)}`,
        b.dimension != null ? `dimension=${String(b.dimension)}` : null,
        b.current != null && b.limit != null ? `${b.current}/${b.limit}` : null,
        b.min_plan_id != null ? `min_plan=${String(b.min_plan_id)}` : null,
        b.plan_id != null ? `plan=${String(b.plan_id)}` : null,
      ].filter(Boolean);
      message += ` (${bits.join(", ")})`;
    }
  }
  return message;
}
