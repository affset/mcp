import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import { AffsetApiError } from "../client.js";
import type {
  Campaign,
  PayoutRulesResponse,
  TargetingRuleTypesResponse,
  TargetingRulesResponse,
} from "../types.js";
import { getCampaign } from "./getCampaign.js";

function responseText(result: Awaited<ReturnType<typeof getCampaign>>): string {
  const block = result.content[0];
  assert.ok(block && block.type === "text");
  return block.text;
}

function makeClient(overrides: {
  campaign: Campaign;
  targetingRules?: TargetingRulesResponse;
  payoutRules?: PayoutRulesResponse;
  targetingTypes?: TargetingRuleTypesResponse;
}): AffsetClient {
  const targetingRules = overrides.targetingRules ?? { targeting_rules: [] };
  const payoutRules = overrides.payoutRules ?? { payout_rules: [] };
  const targetingTypes = overrides.targetingTypes ?? { targeting_rule_types: [] };

  return {
    get: async (path: string) => {
      if (path === "/api/campaigns/42") return overrides.campaign;
      if (path === "/api/campaigns/42/targeting_rules") return targetingRules;
      if (path === "/api/campaigns/42/payout_rules") return payoutRules;
      if (path === "/api/targeting-rule-types") return targetingTypes;
      if (path === "/api/tenant") return { timezone: "America/Sao_Paulo" };
      throw new Error(`Unexpected path: ${path}`);
    },
    getTenantTimezone: async () => "America/Sao_Paulo",
  } as unknown as AffsetClient;
}

describe("getCampaign", () => {
  it("renders the full campaign record, untruncated offer URL included", async () => {
    const longUrl =
      "https://offer.example/landing-page-with-a-very-long-path?utm_source=affset&click={click_id}";
    const campaign: Campaign = {
      id: 42,
      name: "Push offer BR",
      status: "active",
      redirect_url: longUrl,
      payment_model: "cpa",
      rate: 0,
      start_date: 1_700_000_000_000,
      end_date: null,
      user_email: "buyer@example.com",
      daily_budget: 50,
      total_budget: null,
      pacing: "even",
      silent: 1,
      payout_goal_type: "sale",
      created_at: 1_699_000_000_000,
      updated_at: 1_699_500_000_000,
    };

    const client = makeClient({
      campaign,
      targetingRules: {
        targeting_rules: [
          { id: 1, targeting_rule_type_id: 1, targeting_method: "whitelist", rule: "BR" },
        ],
      },
      targetingTypes: { targeting_rule_types: [{ id: 1, name: "geo", description: "Country" }] },
      payoutRules: {
        payout_rules: [{ id: 7, campaign_id: 42, zone_id: null, payout: 2.5, created_at: 1 }],
      },
    });

    const result = await getCampaign(client, { campaign_id: 42 });
    const text = responseText(result);

    // Full URL present, not the ~45-char truncation list_campaigns uses.
    assert.match(text, new RegExp(longUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /\| Status \| active \|/);
    assert.match(text, /\| Pacing \| even \|/);
    assert.match(text, /\| Start date \| .*America\/Sao_Paulo \(1700000000000 epoch ms\) \|/);
    assert.match(text, /\| Silent conversions \| yes \|/);
    assert.match(text, /\| Payout goal type \| sale \|/);
    assert.match(text, /geo \(1\)/);
    assert.match(text, /\| global \| — \| \$2\.50 \| `7` \|/);
  });

  it("distinguishes absent flags and escapes free text in campaign fields", async () => {
    const campaign: Campaign = {
      id: 42,
      name: "Campaign",
      status: "paused",
      budget_pause_reason: "daily | cap\nreached",
      payout_goal_type: "lead | qualified\nrow",
    };

    const text = responseText(await getCampaign(makeClient({ campaign }), { campaign_id: 42 }));

    assert.match(text, /\| Budget paused \| — \|/);
    assert.match(text, /\| Silent conversions \| — \|/);
    assert.match(text, /\| Payout goal type \| lead \\\| qualified row \|/);
  });

  it("explains ineffective targeting and a missing global payout", async () => {
    const campaign: Campaign = { id: 42, name: "Campaign", status: "active" };
    const client = makeClient({
      campaign,
      targetingRules: {
        targeting_rules: [
          { id: 2, targeting_rule_type_id: 8, targeting_method: "whitelist", rule: "9-17" },
        ],
      },
      targetingTypes: {
        targeting_rule_types: [{ id: 8, name: "hours", description: "Hours" }],
      },
      payoutRules: {
        payout_rules: [{ id: 9, campaign_id: 42, zone_id: "zone-1", payout: 1, created_at: 1 }],
      },
    });

    const text = responseText(await getCampaign(client, { campaign_id: 42 }));

    assert.match(text, /`hours` .*This rule has no effect/);
    assert.match(text, /No global rule .*without an override resolve to \*\*\$0\*\*/);
  });

  it("returns a clear error for an unknown campaign id", async () => {
    const client = {
      get: async () => {
        throw new AffsetApiError(404, "not found");
      },
      getTenantTimezone: async () => "UTC",
    } as unknown as AffsetClient;

    const result = await getCampaign(client, { campaign_id: 999 });
    const text = responseText(result);

    assert.equal(result.isError, true);
    assert.match(text, /Campaign `999` not found/);
  });

  it("does not misreport a related-resource 404 as a missing campaign", async () => {
    const client = {
      get: async (path: string) => {
        if (path === "/api/campaigns/42") {
          return { id: 42, name: "Campaign", status: "active" };
        }
        if (path === "/api/campaigns/42/targeting_rules") {
          throw new AffsetApiError(404, "targeting rules unavailable");
        }
        if (path === "/api/campaigns/42/payout_rules") return { payout_rules: [] };
        if (path === "/api/targeting-rule-types") return { targeting_rule_types: [] };
        throw new Error(`Unexpected path: ${path}`);
      },
      getTenantTimezone: async () => "UTC",
    } as unknown as AffsetClient;

    const result = await getCampaign(client, { campaign_id: 42 });
    const text = responseText(result);

    assert.equal(result.isError, true);
    assert.match(text, /affset API error \(404\): targeting rules unavailable/);
    assert.doesNotMatch(text, /Campaign `42` not found/);
  });
});
