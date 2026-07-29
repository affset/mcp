import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { resolveRange, RANGE_PRESETS } from "../lib/time.js";
import { conversionRate, money, mdCell, pct, roi as fmtRoi } from "../lib/format.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import type {
  StatsResponse,
  StatRow,
  TargetingRule,
  TargetingRulesResponse,
  TargetingRuleTypesResponse,
} from "../types.js";

/** Fallback zone targeting-rule-type id (matches the core migration seed). */
const ZONE_RULE_TYPE_FALLBACK = 4;

export const CUT_ZONES_DESCRIPTION =
  "Blacklist underperforming zones on a campaign based on thresholds (CR, spend, ROI). " +
  "Evaluates zone stats over the given window and adds matching zones to the campaign's " +
  "zone blacklist. DRY-RUN by default: it shows which zones would be cut and how the " +
  "blacklist changes. Pass confirm=true to actually apply. `spend` means media_cost " +
  "(your traffic cost). A zone is cut only if it matches ALL provided thresholds.";

export const cutZonesInputSchema = {
  campaign_id: z
    .union([z.string().min(1), z.number().int()])
    .describe("Campaign whose zone blacklist to edit."),
  cr_max: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Cut zones with conversion rate BELOW this fraction (e.g. 0.002 = 0.2%)."),
  spend_min: z
    .number()
    .min(0)
    .optional()
    .describe("Cut zones with media_cost ABOVE this many dollars (e.g. 5 = $5)."),
  roi_max: z
    .number()
    .optional()
    .describe("Cut zones with ROI BELOW this fraction (e.g. -0.3 = -30%). Needs cost data."),
  min_clicks: z
    .number()
    .int()
    .min(0)
    .default(10)
    .describe("Ignore zones with fewer clicks than this (significance guard). Default 10."),
  range: z
    .enum(RANGE_PRESETS)
    .optional()
    .describe("Evaluation window. Ignored if from/to are given. Defaults to last 7 days."),
  from: z
    .string()
    .optional()
    .describe(
      "Explicit start bound: YYYY-MM-DD (tenant-local start of day), ISO timestamp with Z/UTC offset, or epoch ms.",
    ),
  to: z
    .string()
    .optional()
    .describe(
      "Explicit end bound: YYYY-MM-DD (tenant-local end of day), ISO timestamp with Z/UTC offset, or epoch ms.",
    ),
  confirm: z
    .boolean()
    .default(false)
    .describe("false = dry-run preview (default). true = apply the blacklist changes."),
};

type CutZonesArgs = {
  campaign_id: string | number;
  cr_max?: number;
  spend_min?: number;
  roi_max?: number;
  min_clicks: number;
  range?: (typeof RANGE_PRESETS)[number];
  from?: string;
  to?: string;
  confirm: boolean;
};

export async function cutZones(client: AffsetClient, args: CutZonesArgs): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    if (args.cr_max === undefined && args.spend_min === undefined && args.roi_max === undefined) {
      return textError("Provide at least one threshold: cr_max, spend_min, or roi_max.");
    }

    const timeZone = await client.getTenantTimezone();
    const { from, to, label } = resolveRange(
      args.range ?? "last_7_days",
      args.from,
      args.to,
      timeZone,
    );

    // 1. Zone-level stats for this campaign over the window.
    const stats = await client.get<StatsResponse>("/api/stats", {
      from,
      to,
      group_by: "zone_id",
      campaign_ids: campaignId,
    });
    const rows = (stats.stats ?? []).filter((r) => (r.zone_id ?? "").trim() !== "");

    // 2. Select candidates: enough clicks AND matches every provided threshold.
    const candidates = rows.filter((r) => matchesThresholds(r, args));

    // 3. Current targeting rules + the zone rule type id.
    const [zoneTypeId, currentRules] = await Promise.all([
      resolveZoneRuleTypeId(client),
      fetchRules(client, campaignId),
    ]);

    const alreadyBlacklisted = collectBlacklistedZones(currentRules, zoneTypeId);
    const zonesToAdd = candidates
      .map((r) => r.zone_id as string)
      .filter((z) => !alreadyBlacklisted.has(z));

    const criteria = describeCriteria(args);
    const preview = renderCandidates(candidates, alreadyBlacklisted);
    const beforeCount = alreadyBlacklisted.size;
    const afterCount = beforeCount + zonesToAdd.length;
    const costNote = costDataNote(args, rows);

    // 4a. Dry-run (default).
    if (!args.confirm) {
      const head =
        zonesToAdd.length > 0
          ? `**Dry run** — ${zonesToAdd.length} zone(s) would be blacklisted on campaign \`${campaignId}\`.`
          : `**Dry run** — no new zones to blacklist on campaign \`${campaignId}\`.`;
      return textResult(
        `${head}\n_Window: ${label}. Criteria: ${criteria}._\n\n${preview}\n\n` +
          `Zone blacklist: ${beforeCount} → ${afterCount}.` +
          (zonesToAdd.length > 0 ? "\n\nCall again with `confirm: true` to apply." : "") +
          costNote,
      );
    }

    // 4b. Apply — re-fetch rules immediately before write to shrink the TOCTOU window
    // (POST sync deletes any rule whose id is omitted).
    if (zonesToAdd.length === 0) {
      return textResult(
        `Nothing to apply — no new zones matched on campaign \`${campaignId}\`.\n_Criteria: ${criteria}._${costNote}`,
      );
    }

    const freshRules = await fetchRules(client, campaignId);
    const freshBlacklisted = collectBlacklistedZones(freshRules, zoneTypeId);
    const freshToAdd = zonesToAdd.filter((z) => !freshBlacklisted.has(z));

    if (freshToAdd.length === 0) {
      return textResult(
        `Nothing to apply — matching zones are already blacklisted on campaign \`${campaignId}\`.`,
      );
    }

    const nextRules = mergeBlacklist(freshRules, zoneTypeId, freshToAdd);
    await client.post(
      `/api/campaigns/${encodeURIComponent(campaignId)}/targeting_rules`,
      nextRules,
    );

    const appliedBefore = freshBlacklisted.size;
    const appliedAfter = appliedBefore + freshToAdd.length;
    return textResult(
      `✅ Applied. Added ${freshToAdd.length} zone(s) to campaign \`${campaignId}\` blacklist ` +
        `(${appliedBefore} → ${appliedAfter}).\n_Criteria: ${criteria}. Window: ${label}._\n\n${preview}`,
    );
  } catch (err) {
    return errorResult(err);
  }
}

function matchesThresholds(r: StatRow, args: CutZonesArgs): boolean {
  if (r.clicks < args.min_clicks) return false;
  if (args.cr_max !== undefined && !(conversionRate(r) < args.cr_max)) return false;
  if (args.spend_min !== undefined && !((r.media_cost ?? 0) > args.spend_min)) return false;
  if (
    args.roi_max !== undefined &&
    !(r.roi !== null && r.roi !== undefined && r.roi < args.roi_max)
  ) {
    return false;
  }
  return true;
}

function costDataNote(args: CutZonesArgs, rows: StatRow[]): string {
  const usedCostThreshold = args.spend_min !== undefined || args.roi_max !== undefined;
  const hasAnyCost = rows.some((r) => (r.media_cost ?? 0) > 0);
  if (usedCostThreshold && !hasAnyCost) {
    return "\n\n⚠️ A cost/ROI threshold was set but no media_cost is present for these zones — nothing can match it yet.";
  }
  return "";
}

async function fetchRules(client: AffsetClient, campaignId: string): Promise<TargetingRule[]> {
  const res = await client.get<TargetingRulesResponse>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/targeting_rules`,
  );
  return res.targeting_rules ?? [];
}

/** Look up the zone_id targeting-rule-type id, falling back to the seed value. */
async function resolveZoneRuleTypeId(client: AffsetClient): Promise<number> {
  try {
    const res = await client.get<TargetingRuleTypesResponse>("/api/targeting-rule-types");
    const match = (res.targeting_rule_types ?? []).find((t) => t.name === "zone_id");
    return match?.id ?? ZONE_RULE_TYPE_FALLBACK;
  } catch {
    return ZONE_RULE_TYPE_FALLBACK;
  }
}

function parseZoneList(rule: string): string[] {
  return rule
    .split(",")
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
}

/** Union of all zones across the campaign's zone-type blacklist rules. */
function collectBlacklistedZones(rules: TargetingRule[], zoneTypeId: number): Set<string> {
  const zones = new Set<string>();
  for (const rule of rules) {
    if (rule.targeting_rule_type_id === zoneTypeId && rule.targeting_method === "blacklist") {
      for (const z of parseZoneList(rule.rule)) zones.add(z);
    }
  }
  return zones;
}

/**
 * Build the full rule array to POST. All existing rules are echoed back with
 * their ids (the API deletes any it doesn't receive), and the new zones are
 * merged into the first zone-type blacklist rule — or a new one is appended.
 */
function mergeBlacklist(
  rules: TargetingRule[],
  zoneTypeId: number,
  zonesToAdd: string[],
): TargetingRule[] {
  const next: TargetingRule[] = rules.map((r) => ({
    id: r.id,
    targeting_rule_type_id: r.targeting_rule_type_id,
    targeting_method: r.targeting_method,
    rule: r.rule,
  }));

  const target = next.find(
    (r) => r.targeting_rule_type_id === zoneTypeId && r.targeting_method === "blacklist",
  );

  if (target) {
    const merged = new Set([...parseZoneList(target.rule), ...zonesToAdd]);
    target.rule = [...merged].join(",");
  } else {
    next.push({
      targeting_rule_type_id: zoneTypeId,
      targeting_method: "blacklist",
      rule: zonesToAdd.join(","),
    });
  }

  return next;
}

function describeCriteria(args: CutZonesArgs): string {
  const parts: string[] = [];
  if (args.cr_max !== undefined) parts.push(`CR < ${pct(args.cr_max)}`);
  if (args.spend_min !== undefined) parts.push(`spend > ${money(args.spend_min)}`);
  if (args.roi_max !== undefined) parts.push(`ROI < ${fmtRoi(args.roi_max)}`);
  parts.push(`min ${args.min_clicks} clicks`);
  return parts.join(", ");
}

function renderCandidates(candidates: StatRow[], alreadyBlacklisted: Set<string>): string {
  if (candidates.length === 0) return "_No zones matched._";
  const lines = [
    "| Zone | Clicks | Conv | CR | Cost | ROI | Status |",
    "|---|--:|--:|--:|--:|--:|---|",
  ];
  for (const r of candidates) {
    const zoneId = r.zone_id as string;
    const status = alreadyBlacklisted.has(zoneId) ? "already blacklisted" : "will add";
    lines.push(
      `| ${mdCell(r.zone_name ?? zoneId)} | ${r.clicks} | ${r.conversions} | ${pct(
        conversionRate(r),
      )} | ${money(r.media_cost)} | ${fmtRoi(r.roi)} | ${status} |`,
    );
  }
  return lines.join("\n");
}
