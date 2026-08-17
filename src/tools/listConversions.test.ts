import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { ConversionsResponse } from "../types.js";
import { listConversions, listConversionsInputSchema } from "./listConversions.js";

const BASE_ARGS = {
  limit: 20,
  offset: 0,
  sort: "created_at",
  order: "desc",
} as const;

const RESPONSE: ConversionsResponse = {
  conversions: [
    {
      ad_event_id: "101",
      click_id: "click-1",
      payload: JSON.stringify({ type: "lead", postback_ok: true, postback_status: 200 }),
      payout: 1.5,
      spend: 0.5,
      source_click_id: "src-1",
      created_at: 1_754_006_400_000,
    },
  ],
  pagination: { total: 1, limit: 20, offset: 0, has_more: false },
};

function makeClient(response: ConversionsResponse) {
  const queries = new Map<string, Record<string, string | number | undefined> | undefined>();
  const client = {
    get: async (path: string, query?: Record<string, string | number | undefined>) => {
      queries.set(path, query);
      if (path === "/api/conversions") return response;
      if (path === "/api/tenant") return {};
      throw new Error(`Unexpected path: ${path}`);
    },
  } as unknown as AffsetClient;
  return { client, queries };
}

function responseText(result: Awaited<ReturnType<typeof listConversions>>): string {
  const block = result.content[0];
  assert.ok(block && block.type === "text");
  return block.text;
}

describe("listConversions paid_only filter", () => {
  it("forwards paid_only=true to the API and flags it in the header", async () => {
    const { client, queries } = makeClient(RESPONSE);
    const result = await listConversions(client, { ...BASE_ARGS, paid_only: true });
    assert.deepEqual(queries.get("/api/conversions"), {
      limit: 20,
      offset: 0,
      sort: "created_at",
      order: "desc",
      paid_only: "true",
    });
    const text = responseText(result);
    assert.match(text, /filters: paid_only/);
    assert.match(text, /`paid_only` is server-side/);
  });

  it("omits paid_only from the query when unset", async () => {
    const { client, queries } = makeClient(RESPONSE);
    const result = await listConversions(client, { ...BASE_ARGS });
    assert.deepEqual(queries.get("/api/conversions"), {
      limit: 20,
      offset: 0,
      sort: "created_at",
      order: "desc",
    });
    const text = responseText(result);
    assert.doesNotMatch(text, /filters:/);
    assert.match(text, /`paid_only` is server-side/);
  });

  it("passes an explicit paid_only=false through without flagging a filter", async () => {
    const { client, queries } = makeClient(RESPONSE);
    const result = await listConversions(client, { ...BASE_ARGS, paid_only: false });
    assert.equal(queries.get("/api/conversions")?.paid_only, "false");
    assert.doesNotMatch(responseText(result), /filters:/);
  });

  it("keeps paid_only optional and boolean-only in the schema", () => {
    assert.equal(listConversionsInputSchema.paid_only.safeParse(true).success, true);
    assert.equal(listConversionsInputSchema.paid_only.safeParse(false).success, true);
    assert.equal(listConversionsInputSchema.paid_only.safeParse(undefined).success, true);
    assert.equal(listConversionsInputSchema.paid_only.safeParse("true").success, false);
  });
});
