import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { findPayoutRule, replacePayout } from "./payoutRules.js";
import type { PayoutRule } from "../types.js";

const EXISTING: PayoutRule = { id: 7, campaign_id: 42, zone_id: null, payout: 2.5 };

type PostBody = { payout: number; zone_id?: string };

/** Records the write sequence; `failCreates` fails the first N POSTs. */
function fakeClient(failCreates: number) {
  const calls: string[] = [];
  const posted: PostBody[] = [];
  let creates = 0;
  const client = {
    delete: async () => {
      calls.push("delete");
      return null;
    },
    post: async (_path: string, body: unknown) => {
      creates += 1;
      calls.push("post");
      posted.push(body as PostBody);
      if (creates <= failCreates) throw new AffsetApiError(500, "boom");
      return { ...EXISTING, id: 8, payout: (body as PostBody).payout };
    },
  } as unknown as AffsetClient;
  return { client, calls, posted };
}

describe("replacePayout", () => {
  it("deletes then creates, since the API has no update for a payout rule", async () => {
    const { client, calls, posted } = fakeClient(0);
    const result = await replacePayout(client, "42", null, EXISTING, 4);

    assert.ok("rule" in result);
    assert.equal(result.rule.payout, 4);
    assert.deepEqual(calls, ["delete", "post"]);
    assert.deepEqual(posted, [{ payout: 4 }]);
  });

  it("restores the old payout when the create fails, so nothing serves at $0", async () => {
    const { client, calls, posted } = fakeClient(1);
    const result = await replacePayout(client, "42", null, EXISTING, 4);

    assert.ok("rolledBack" in result);
    assert.equal(result.rolledBack.payout, 2.5);
    assert.deepEqual(calls, ["delete", "post", "post"]);
    assert.deepEqual(posted[1], { payout: 2.5 });
  });

  it("reports the rule as lost when the restore fails too", async () => {
    const { client } = fakeClient(2);
    const result = await replacePayout(client, "42", null, EXISTING, 4);

    assert.ok("lost" in result);
    assert.equal(result.lost.id, 7);
    assert.ok(result.cause instanceof AffsetApiError);
    assert.ok(result.rollbackCause instanceof AffsetApiError);
  });

  it("scopes the write to the zone it was asked for", async () => {
    const { client, posted } = fakeClient(0);
    await replacePayout(client, "42", "zone-1", { ...EXISTING, zone_id: "zone-1" }, 4);
    assert.deepEqual(posted, [{ payout: 4, zone_id: "zone-1" }]);
  });
});

describe("findPayoutRule", () => {
  const rules: PayoutRule[] = [EXISTING, { id: 8, campaign_id: 42, zone_id: "zone-1", payout: 3 }];

  it("treats a null zone as the global rule rather than the first row", () => {
    assert.equal(findPayoutRule(rules, null)?.id, 7);
    assert.equal(findPayoutRule(rules, "zone-1")?.id, 8);
    assert.equal(findPayoutRule(rules, "zone-2"), undefined);
  });
});
