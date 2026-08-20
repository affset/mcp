import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { StatsResponse } from "../types.js";
import { getStats, getStatsInputSchema } from "./getStats.js";

const EMPTY_RESPONSE: StatsResponse = {
  stats: [],
  period: { from: 1_754_006_400_000, to: 1_754_092_799_999 },
};

function makeClient(response: StatsResponse = EMPTY_RESPONSE) {
  let requestedQuery: Record<string, string | number | undefined> | undefined;
  const client = {
    getTenantTimezone: async () => "UTC",
    get: async (path: string, query?: Record<string, string | number | undefined>) => {
      assert.equal(path, "/api/stats");
      requestedQuery = query;
      return response;
    },
  } as unknown as AffsetClient;
  return {
    client,
    query: () => requestedQuery,
  };
}

function responseText(result: Awaited<ReturnType<typeof getStats>>): string {
  const block = result.content[0];
  assert.ok(block && block.type === "text");
  return block.text;
}

describe("getStats user grouping and filters", () => {
  it("forwards standalone user filters and renders advertiser groups", async () => {
    const response: StatsResponse = {
      stats: [
        {
          advertiser_email: "buyer@example.com",
          impressions: 10,
          fallbacks: 0,
          unsold: 0,
          clicks: 5,
          conversions: 1,
          payout: 2,
          media_cost: 1,
          roi: 1,
        },
      ],
      period: { from: 1_754_006_400_000, to: 1_754_092_799_999 },
    };
    const { client, query } = makeClient(response);

    const result = await getStats(client, {
      group_by: "advertiser_email",
      from: "2025-08-01",
      to: "2025-08-01",
      advertiser_email: " buyer@example.com ",
      publisher_email: "publisher@example.com",
    });

    assert.deepEqual(query(), {
      from: Date.UTC(2025, 7, 1),
      to: Date.UTC(2025, 7, 1, 23, 59, 59, 999),
      group_by: "advertiser_email",
      paid_only: "true",
      advertiser_email: "buyer@example.com",
      publisher_email: "publisher@example.com",
    });
    assert.match(responseText(result), /by Advertiser/);
    assert.match(responseText(result), /\| buyer@example\.com \|/);
  });

  it("trims and validates user email filters", () => {
    assert.equal(
      getStatsInputSchema.advertiser_email.parse(" buyer@example.com "),
      "buyer@example.com",
    );
    assert.equal(
      getStatsInputSchema.publisher_email.parse("publisher@example.com"),
      "publisher@example.com",
    );
    assert.equal(getStatsInputSchema.advertiser_email.safeParse("").success, false);
    assert.equal(getStatsInputSchema.publisher_email.safeParse("not-an-email").success, false);
  });
});

describe("getStats paid_only filter", () => {
  it("defaults to true and always forwards it — the API treats omit as false", async () => {
    const { client, query } = makeClient();
    const result = await getStats(client, {
      group_by: "date",
      from: "2025-08-01",
      to: "2025-08-01",
    });
    assert.equal(query()?.paid_only, "true");
    assert.doesNotMatch(responseText(result), /informative conversions/);
  });

  it("forwards paid_only=false and notes it in the heading", async () => {
    const { client, query } = makeClient();
    const result = await getStats(client, {
      group_by: "date",
      from: "2025-08-01",
      to: "2025-08-01",
      paid_only: false,
    });
    assert.equal(query()?.paid_only, "false");
    assert.match(responseText(result), /including informative conversions/);
  });

  it("defaults paid_only to true in the schema and rejects non-booleans", () => {
    assert.equal(getStatsInputSchema.paid_only.parse(undefined), true);
    assert.equal(getStatsInputSchema.paid_only.parse(true), true);
    assert.equal(getStatsInputSchema.paid_only.parse(false), false);
    assert.equal(getStatsInputSchema.paid_only.safeParse("true").success, false);
  });
});
