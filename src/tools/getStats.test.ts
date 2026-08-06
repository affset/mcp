import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { StatsResponse } from "../types.js";
import { getStats, getStatsInputSchema } from "./getStats.js";

function responseText(result: Awaited<ReturnType<typeof getStats>>): string {
  const block = result.content[0];
  assert.ok(block && block.type === "text");
  return block.text;
}

describe("getStats user grouping and filters", () => {
  it("forwards standalone user filters and renders advertiser groups", async () => {
    let requestedQuery: Record<string, string | number | undefined> | undefined;
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
    const client = {
      getTenantTimezone: async () => "UTC",
      get: async (path: string, query?: Record<string, string | number | undefined>) => {
        assert.equal(path, "/api/stats");
        requestedQuery = query;
        return response;
      },
    } as unknown as AffsetClient;

    const result = await getStats(client, {
      group_by: "advertiser_email",
      from: "2025-08-01",
      to: "2025-08-01",
      advertiser_email: " buyer@example.com ",
      publisher_email: "publisher@example.com",
    });

    assert.deepEqual(requestedQuery, {
      from: Date.UTC(2025, 7, 1),
      to: Date.UTC(2025, 7, 1, 23, 59, 59, 999),
      group_by: "advertiser_email",
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
