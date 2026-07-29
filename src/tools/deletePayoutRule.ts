import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { moneyPrecise } from "../lib/format.js";
import { deletePayoutScope, fetchPayoutRules, findPayoutRule } from "../lib/payoutRules.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";

export const DELETE_PAYOUT_RULE_DESCRIPTION =
  "Delete a campaign payout rule (global or per-zone). Omit zone_id to delete the " +
  "global rule; pass a zone UUID to delete that zone's override. DRY-RUN by default; " +
  "pass confirm=true to apply. Without a global rule, conversions resolve to $0.";

export const deletePayoutRuleInputSchema = {
  campaign_id: z
    .union([z.string().min(1), z.number().int()])
    .describe("Campaign whose payout rule to delete."),
  zone_id: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Zone UUID of the zone-specific rule. Omit to delete the global rule."),
  confirm: z.boolean().default(false).describe("false = dry-run preview (default). true = apply."),
};

type DeletePayoutRuleArgs = {
  campaign_id: string | number;
  zone_id?: string;
  confirm: boolean;
};

export async function deletePayoutRule(
  client: AffsetClient,
  args: DeletePayoutRuleArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    const zoneId = args.zone_id?.trim() || null;
    const scope = zoneId == null ? "global" : `zone \`${zoneId}\``;

    const rules = await fetchPayoutRules(client, campaignId);
    const existing = findPayoutRule(rules, zoneId);
    if (!existing) {
      return textError(`No ${scope} payout rule on campaign \`${campaignId}\`.`);
    }

    // Deleting the global rule while zone overrides remain leaves every other
    // zone at $0 — worth saying before it is confirmed, not after.
    const fallbackWarning =
      zoneId == null
        ? "⚠️ Conversions on zones without their own override will resolve to **$0**."
        : findPayoutRule(rules, null)
          ? "Conversions on this zone fall back to the global payout."
          : "⚠️ There is no global rule, so conversions on this zone will resolve to **$0**.";

    if (!args.confirm) {
      return textResult(
        [
          `**Dry run** — would delete ${scope} payout on campaign \`${campaignId}\`.`,
          "",
          `| Field | Value |`,
          `|---|---|`,
          `| Rule id | \`${existing.id}\` |`,
          `| Payout | ${moneyPrecise(existing.payout)} |`,
          `| Scope | ${scope} |`,
          "",
          fallbackWarning,
          "",
          "Call again with `confirm: true` to apply.",
        ].join("\n"),
      );
    }

    await deletePayoutScope(client, campaignId, zoneId);

    return textResult(
      [
        `✅ Deleted ${scope} payout on campaign \`${campaignId}\` ` +
          `(was ${moneyPrecise(existing.payout)}, rule id \`${existing.id}\`).`,
        "",
        fallbackWarning,
      ].join("\n"),
    );
  } catch (err) {
    if (err instanceof AffsetApiError && err.status === 404) {
      return textError(
        `Campaign \`${String(args.campaign_id).trim()}\` not found, or no matching payout rule.`,
      );
    }
    return errorResult(err);
  }
}
