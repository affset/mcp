/**
 * Payout-rule helpers shared by the payout tools.
 *
 * The API has no update for a payout rule: the (campaign, zone) pair is unique,
 * so a create over an existing scope returns 409 and changing a payout means
 * delete-then-create. That leaves a window where the campaign has no rule at all,
 * and a campaign with no matching rule resolves every conversion to $0 — silently,
 * because a missing payout is a normal state rather than an error. `replacePayout`
 * exists so that window is always either closed or reported.
 */

import { type AffsetClient } from "../client.js";
import type { PayoutRule, PayoutRulesResponse } from "../types.js";

export async function fetchPayoutRules(
  client: AffsetClient,
  campaignId: string,
): Promise<PayoutRule[]> {
  const res = await client.get<PayoutRulesResponse>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/payout_rules`,
  );
  return res.payout_rules ?? [];
}

/** The rule governing one scope: `null` zoneId is the campaign-wide rule. */
export function findPayoutRule(rules: PayoutRule[], zoneId: string | null): PayoutRule | undefined {
  return rules.find((r) => (zoneId == null ? r.zone_id == null : r.zone_id === zoneId));
}

/** Delete the rule governing one scope (`null` zoneId = the campaign-wide rule). */
export async function deletePayoutScope(
  client: AffsetClient,
  campaignId: string,
  zoneId: string | null,
): Promise<void> {
  await client.delete(
    `/api/campaigns/${encodeURIComponent(campaignId)}/payout_rules`,
    zoneId == null ? undefined : { zone_id: zoneId },
  );
}

export async function createPayoutRule(
  client: AffsetClient,
  campaignId: string,
  zoneId: string | null,
  payout: number,
): Promise<PayoutRule> {
  return client.post<PayoutRule>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/payout_rules`,
    zoneId == null ? { payout } : { payout, zone_id: zoneId },
  );
}

export type ReplaceResult =
  | { rule: PayoutRule }
  /** Create failed; the previous payout was put back, so nothing was lost. */
  | { rolledBack: PayoutRule; cause: unknown }
  /** Create failed and the rollback failed too — the scope now has no rule. */
  | { lost: PayoutRule; cause: unknown; rollbackCause: unknown };

/**
 * Replace the payout for one scope. On a failed create the previous rule is
 * restored, so a network blip or a rejected value cannot leave the campaign
 * paying $0 on every conversion.
 */
export async function replacePayout(
  client: AffsetClient,
  campaignId: string,
  zoneId: string | null,
  existing: PayoutRule,
  payout: number,
): Promise<ReplaceResult> {
  await deletePayoutScope(client, campaignId, zoneId);

  try {
    return { rule: await createPayoutRule(client, campaignId, zoneId, payout) };
  } catch (cause) {
    try {
      await createPayoutRule(client, campaignId, zoneId, existing.payout);
      return { rolledBack: existing, cause };
    } catch (rollbackCause) {
      return { lost: existing, cause, rollbackCause };
    }
  }
}
