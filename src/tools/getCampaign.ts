import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { formatInstant } from "../lib/time.js";
import { mdCell, money, moneyPrecise } from "../lib/format.js";
import { fetchPayoutRules } from "../lib/payoutRules.js";
import { fetchTargetingRules, fetchTargetingTypes, UNENFORCED_TYPES } from "../lib/targeting.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import type { Campaign, PayoutRule, TargetingRule, TargetingRuleType } from "../types.js";

export const GET_CAMPAIGN_DESCRIPTION =
  "Get one campaign's full record: every field (including the untruncated offer URL, " +
  "exact schedule, budgets/pacing, silent-conversions flag, payout goal type) plus its " +
  "targeting rules and payout rules in one call. `list_campaigns` renders a summary table " +
  "(offer URL truncated, no dates/pacing/silent) meant for scanning many campaigns; use " +
  "this when you need one campaign's complete data — e.g. before recreating it as a new " +
  "campaign, or before editing it with `update_campaign`.";

export const getCampaignInputSchema = {
  campaign_id: z
    .union([
      z
        .string()
        .trim()
        .regex(/^[1-9]\d*$/, "campaign_id must be a positive integer")
        .refine((value) => Number.isSafeInteger(Number(value)), "campaign_id is too large"),
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ])
    .describe("Campaign id to fetch."),
};

type GetCampaignArgs = {
  campaign_id: string | number;
};

export async function getCampaign(
  client: AffsetClient,
  args: GetCampaignArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    let campaign: Campaign;
    try {
      campaign = await client.get<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}`);
    } catch (err) {
      if (err instanceof AffsetApiError && err.status === 404) {
        return textError(`Campaign \`${campaignId}\` not found in this namespace.`);
      }
      throw err;
    }

    const [targetingRules, payoutRules, targetingTypes, timeZone] = await Promise.all([
      fetchTargetingRules(client, campaignId),
      fetchPayoutRules(client, campaignId),
      // Names are a nicety; the rule table still works with bare type ids.
      fetchTargetingTypes(client).catch((): TargetingRuleType[] => []),
      client.getTenantTimezone(),
    ]);

    const typeById = new Map(targetingTypes.map((t) => [t.id, t]));
    const fmt = (ms: number | null | undefined) =>
      ms == null ? "—" : `${formatInstant(ms, timeZone)} ${mdCell(timeZone)} (${ms} epoch ms)`;
    const deadTargetingRules = targetingRules.filter((rule) => {
      const name = typeById.get(rule.targeting_rule_type_id)?.name.toLowerCase();
      return name !== undefined && UNENFORCED_TYPES[name] !== undefined;
    });
    const payoutGoal = campaign.payout_goal_type?.trim();

    const fields = [
      "| Field | Value |",
      "|---|---|",
      `| Id | ${campaign.id} |`,
      `| Name | ${mdCell(campaign.name)} |`,
      `| Status | ${mdCell(campaign.status)} |`,
      `| Advertiser | ${mdCell(campaign.user_email ?? "—")} |`,
      `| Offer URL | ${mdCell(campaign.redirect_url ?? "—")} |`,
      `| Model | ${mdCell(campaign.payment_model ?? "—")} |`,
      `| Rate | ${campaign.rate != null ? moneyPrecise(campaign.rate) : "—"} |`,
      `| Start date | ${fmt(campaign.start_date)} |`,
      `| End date | ${fmt(campaign.end_date)} |`,
      `| Daily budget | ${money(campaign.daily_budget)} |`,
      `| Total budget | ${money(campaign.total_budget)} |`,
      `| Pacing | ${mdCell(campaign.pacing ?? "—")} |`,
      `| Budget paused | ${formatBudgetPaused(campaign)} |`,
      `| Silent conversions | ${formatFlag(campaign.silent)} |`,
      `| Payout goal type | ${payoutGoal ? mdCell(payoutGoal) : "_none — every conversion type gets the resolved payout_"} |`,
      `| Created | ${fmt(campaign.created_at)} |`,
      `| Updated | ${fmt(campaign.updated_at)} |`,
    ];

    return textResult(
      [
        `**Campaign** \`${campaign.id}\` — ${mdCell(campaign.name)}`,
        "",
        fields.join("\n"),
        "",
        `**Targeting rules** (${targetingRules.length})`,
        "",
        renderTargetingRules(targetingRules, typeById),
        ...(deadTargetingRules.length
          ? ["", ...renderDeadTargetingWarnings(deadTargetingRules, typeById)]
          : []),
        "",
        `**Payout rules** (${payoutRules.length})`,
        "",
        renderPayoutRules(payoutRules),
        "",
        "_Recreate elsewhere with `create_campaign` + `update_campaign`, then " +
          "`set_targeting_rule` / `set_payout_rule` for each rule above._",
        "_Manage this campaign with `update_campaign`, `set_campaign_status`, " +
          "`set_targeting_rule`, `set_payout_rule`, `set_payout_goal`._",
      ].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}

function formatFlag(value: number | undefined): string {
  if (value == null) return "—";
  return value ? "yes" : "no";
}

function formatBudgetPaused(campaign: Campaign): string {
  if (campaign.budget_paused == null) return "—";
  if (!campaign.budget_paused) return "no";
  const reason = campaign.budget_pause_reason?.trim();
  return reason ? `yes (${mdCell(reason)})` : "yes (reason unavailable)";
}

function renderTargetingRules(
  rules: TargetingRule[],
  typeById: Map<number, TargetingRuleType>,
): string {
  if (rules.length === 0) {
    return "_No targeting rules — campaign is unrestricted on /serve._";
  }
  const lines = ["| Id | Type | Method | Rule |", "|---|---|---|---|"];
  for (const r of rules) {
    const t = typeById.get(r.targeting_rule_type_id);
    const typeLabel = t
      ? `${mdCell(t.name)} (${r.targeting_rule_type_id})`
      : String(r.targeting_rule_type_id);
    const inert = t && UNENFORCED_TYPES[t.name.toLowerCase()] ? " ⚠️" : "";
    lines.push(
      `| ${r.id ?? "—"} | ${typeLabel}${inert} | ${mdCell(r.targeting_method)} | ${mdCell(r.rule)} |`,
    );
  }
  return lines.join("\n");
}

function renderDeadTargetingWarnings(
  rules: TargetingRule[],
  typeById: Map<number, TargetingRuleType>,
): string[] {
  const names = [...new Set(rules.map((rule) => typeById.get(rule.targeting_rule_type_id)!.name))];
  return names.map(
    (name) =>
      `⚠️ \`${mdCell(name)}\` — ${UNENFORCED_TYPES[name.toLowerCase()]}. This rule has no effect.`,
  );
}

function renderPayoutRules(rules: PayoutRule[]): string {
  if (rules.length === 0) {
    return "_No payout rules — conversions resolve to $0 until you set one._";
  }
  const lines = ["| Scope | Zone | Payout | Rule id |", "|---|---|--:|---|"];
  for (const r of rules) {
    const scope = r.zone_id == null ? "global" : "zone";
    const zone = r.zone_id == null ? "—" : `\`${r.zone_id}\``;
    lines.push(`| ${scope} | ${zone} | ${moneyPrecise(r.payout)} | \`${r.id}\` |`);
  }
  if (!rules.some((rule) => rule.zone_id == null)) {
    lines.push("");
    lines.push(
      "_⚠️ No global rule — conversions from any zone without an override resolve to **$0**._",
    );
  }
  return lines.join("\n");
}
