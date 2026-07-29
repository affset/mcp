import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { Campaign } from "../types.js";
import { updateCampaign } from "./updateCampaign.js";

describe("updateCampaign schedule dates", () => {
  it("writes date-only bounds in the tenant timezone", async () => {
    const campaign: Campaign = {
      id: 42,
      name: "Offer",
      status: "paused",
      start_date: null,
    };
    let written: unknown;
    const client = {
      getRequiredTenantTimezone: async () => "Europe/Tallinn",
      get: async () => campaign,
      put: async (_path: string, body: unknown) => {
        written = body;
        return { id: 42 };
      },
    } as unknown as AffsetClient;

    const result = await updateCampaign(client, {
      campaign_id: 42,
      start_date: "2026-07-29",
      confirm: true,
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(written, { start_date: Date.UTC(2026, 6, 28, 21) });
  });

  it("does not mutate when the tenant timezone cannot be read", async () => {
    let putCalls = 0;
    const client = {
      getRequiredTenantTimezone: async () => {
        throw new Error("tenant settings unavailable");
      },
      get: async () => {
        throw new Error("campaign read should not run");
      },
      put: async () => {
        putCalls += 1;
      },
    } as unknown as AffsetClient;

    const result = await updateCampaign(client, {
      campaign_id: 42,
      start_date: "2026-07-29",
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal(putCalls, 0);
  });
});
