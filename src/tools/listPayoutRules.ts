import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { mdCell, moneyPrecise } from "../lib/format.js";
import { fetchPayoutRules } from "../lib/payoutRules.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import type { Campaign, PayoutRule } from "../types.js";

export const LIST_PAYOUT_RULES_DESCRIPTION =
  "List a campaign's payout rules (global + per-zone) and its payout_goal_type. " +
  "Global rule applies to all zones; a zone-specific rule overrides it for that zone. " +
  "When payout_goal_type is set, spend/payout apply only on conversions whose pixel " +
  "`type=` exactly matches (others still record, but with $0).";

export const listPayoutRulesInputSchema = {
  campaign_id: z
    .union([z.string().min(1), z.number().int()])
    .describe("Campaign whose payout rules to list."),
};

type ListPayoutRulesArgs = {
  campaign_id: string | number;
};

export async function listPayoutRules(
  client: AffsetClient,
  args: ListPayoutRulesArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    let campaign: Campaign;
    let rules: PayoutRule[];
    try {
      [campaign, rules] = await Promise.all([
        client.get<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}`),
        fetchPayoutRules(client, campaignId),
      ]);
    } catch (err) {
      if (err instanceof AffsetApiError && err.status === 404) {
        return textError(`Campaign \`${campaignId}\` not found in this namespace.`);
      }
      throw err;
    }

    const goal = campaign.payout_goal_type?.trim() || null;
    const goalNote = goal
      ? `\`${goal}\` — only conversions with pixel \`type=${goal}\` get spend/payout`
      : "_none_ — every conversion type gets the resolved payout";

    return textResult(
      [
        `**Payout rules** — campaign \`${campaign.id}\` (${mdCell(campaign.name)})`,
        "",
        `| Field | Value |`,
        `|---|---|`,
        `| Goal type | ${goalNote} |`,
        `| Rules | ${rules.length} |`,
        "",
        renderRules(rules),
        "",
        "_Resolution at conversion: zone-specific → global → $0._",
        "_Manage with `set_payout_rule` / `delete_payout_rule` / `set_payout_goal`._",
      ].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}

function renderRules(rules: PayoutRule[]): string {
  if (rules.length === 0) {
    return "_No payout rules — conversions resolve to $0 until you set one._";
  }
  const lines = ["| Scope | Zone | Payout | Rule id |", "|---|---|--:|---|"];
  for (const r of rules) {
    const scope = r.zone_id == null ? "global" : "zone";
    const zone = r.zone_id == null ? "—" : `\`${r.zone_id}\``;
    lines.push(`| ${scope} | ${zone} | ${moneyPrecise(r.payout)} | \`${r.id}\` |`);
  }
  if (!rules.some((r) => r.zone_id == null)) {
    lines.push("");
    lines.push(
      "_⚠️ No global rule — conversions from any zone without an override resolve to **$0**._",
    );
  }
  return lines.join("\n");
}
