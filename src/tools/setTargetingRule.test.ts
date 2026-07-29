import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AffsetClient } from "../client.js";
import type { TargetingRule } from "../types.js";
import { setTargetingRule } from "./setTargetingRule.js";

const TYPES = {
  targeting_rule_types: [
    { id: 1, name: "geo", description: "Target by country" },
    { id: 4, name: "zone_id", description: null },
    { id: 8, name: "hours", description: null },
  ],
};

function fakeClient(rules: TargetingRule[]) {
  const posted: TargetingRule[][] = [];
  const client = {
    get: async (path: string) => {
      if (path === "/api/targeting-rule-types") return TYPES;
      if (path === "/api/campaigns/42/targeting_rules") return { targeting_rules: rules };
      throw new Error(`Unexpected path: ${path}`);
    },
    post: async (_path: string, body: unknown) => {
      posted.push(body as TargetingRule[]);
      return { targeting_rules: body as TargetingRule[] };
    },
  } as unknown as AffsetClient;
  return { client, posted };
}

function text(result: Awaited<ReturnType<typeof setTargetingRule>>): string {
  const block = result.content[0];
  assert.ok(block && block.type === "text");
  return block.text;
}

const GEO_WHITELIST: TargetingRule = {
  id: 1,
  targeting_rule_type_id: 1,
  targeting_method: "whitelist",
  rule: "BR",
};
const ZONE_BLACKLIST: TargetingRule = {
  id: 2,
  targeting_rule_type_id: 4,
  targeting_method: "blacklist",
  rule: "zone-9",
};

describe("setTargetingRule", () => {
  it("normalises the value before previewing it", async () => {
    const { client } = fakeClient([]);
    const result = await setTargetingRule(client, {
      campaign_id: 42,
      type: "geo",
      method: "whitelist",
      rule: "br, mx",
      confirm: false,
    });

    assert.match(text(result), /BR,MX/);
    assert.match(text(result), /Dry run/);
  });

  it("keeps every other rule, because the endpoint deletes what it is not sent", async () => {
    const { client, posted } = fakeClient([GEO_WHITELIST, ZONE_BLACKLIST]);
    await setTargetingRule(client, {
      campaign_id: 42,
      type: "geo",
      method: "whitelist",
      rule: "br,mx",
      confirm: true,
    });

    assert.equal(posted.length, 1);
    assert.deepEqual(posted[0], [
      { id: 1, targeting_rule_type_id: 1, targeting_method: "whitelist", rule: "BR,MX" },
      { id: 2, targeting_rule_type_id: 4, targeting_method: "blacklist", rule: "zone-9" },
    ]);
  });

  it("refuses a type the serve path never evaluates instead of storing a no-op", async () => {
    const { client, posted } = fakeClient([]);
    const result = await setTargetingRule(client, {
      campaign_id: 42,
      type: "hours",
      method: "whitelist",
      rule: "9,10,11",
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.match(text(result), /not evaluated on \/serve/);
    assert.equal(posted.length, 0);
  });

  it("refuses a value that could never match rather than killing delivery", async () => {
    const { client, posted } = fakeClient([]);
    const result = await setTargetingRule(client, {
      campaign_id: 42,
      type: "geo",
      method: "whitelist",
      rule: "Brazil",
      confirm: true,
    });

    assert.equal(result.isError, true);
    assert.equal(posted.length, 0);
  });

  it("warns when an opposite-method rule of the same type is already in place", async () => {
    const { client } = fakeClient([
      { id: 3, targeting_rule_type_id: 1, targeting_method: "blacklist", rule: "IN" },
    ]);
    const result = await setTargetingRule(client, {
      campaign_id: 42,
      type: "geo",
      method: "whitelist",
      rule: "BR",
      confirm: false,
    });

    assert.match(text(result), /also has a geo \*\*blacklist\*\*/);
  });

  it("does not write when the rule already matches", async () => {
    const { client, posted } = fakeClient([GEO_WHITELIST]);
    const result = await setTargetingRule(client, {
      campaign_id: 42,
      type: "geo",
      method: "whitelist",
      rule: "br",
      confirm: true,
    });

    assert.match(text(result), /Nothing to change/);
    assert.equal(posted.length, 0);
  });
});
