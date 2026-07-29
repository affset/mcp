import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCampaignDateBound, resolveRange } from "./time.js";

describe("date-bound parsing", () => {
  it("resolves campaign calendar dates in the tenant timezone", () => {
    assert.equal(
      parseCampaignDateBound("2026-07-29", "start", "Europe/Tallinn"),
      Date.UTC(2026, 6, 28, 21),
    );
    assert.equal(
      parseCampaignDateBound("2026-07-29", "end", "Europe/Tallinn"),
      Date.UTC(2026, 6, 29, 20, 59, 59, 999),
    );
  });

  it("rejects impossible calendar dates instead of rolling them forward", () => {
    assert.throws(() => parseCampaignDateBound("2026-02-30", "start", "UTC"), /real YYYY-MM-DD/);
    assert.throws(() => resolveRange(undefined, "2026-02-30", undefined, "UTC"), /real/);
  });

  it("rejects invalid numeric epoch values", () => {
    assert.throws(() => parseCampaignDateBound(0, "start", "UTC"), /positive safe integer/);
    assert.throws(
      () => resolveRange(undefined, "99999999999999999999", undefined, "UTC"),
      /positive safe integer/,
    );
  });

  it("requires explicit offsets on timestamps and validates their calendar date", () => {
    assert.equal(
      parseCampaignDateBound("2026-07-29T09:30:00+03:00", "start", "UTC"),
      Date.UTC(2026, 6, 29, 6, 30),
    );
    assert.throws(
      () => parseCampaignDateBound("2026-07-29T09:30:00", "start", "UTC"),
      /with Z\/UTC offset/,
    );
    assert.throws(
      () => parseCampaignDateBound("2026-02-30T09:30:00Z", "start", "UTC"),
      /real YYYY-MM-DD/,
    );
  });
});
