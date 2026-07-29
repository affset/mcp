import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { moneyPrecise } from "../lib/format.js";
import { displayValue, renderDiff, type FieldChange } from "../lib/patch.js";
import {
  createPayoutRule,
  fetchPayoutRules,
  findPayoutRule,
  replacePayout,
} from "../lib/payoutRules.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import type { PayoutRule } from "../types.js";

/** Matches lite-adserver PAYOUT_MIN / PAYOUT_MAX. */
const PAYOUT_MIN = 0.00001;
const PAYOUT_MAX = 9999.99999;

export const SET_PAYOUT_RULE_DESCRIPTION =
  "Set a campaign payout rule (global or per-zone). Upserts: if a rule already " +
  "exists for that scope it is replaced (delete + create, with the old payout " +
  "restored if the create fails). Omit zone_id for the global rule; pass a zone " +
  "UUID for a zone override. DRY-RUN by default; pass confirm=true to apply.";

export const setPayoutRuleInputSchema = {
  campaign_id: z
    .union([z.string().min(1), z.number().int()])
    .describe("Campaign to set the payout rule on."),
  payout: z
    .number()
    .min(PAYOUT_MIN)
    .max(PAYOUT_MAX)
    .describe(`Payout per conversion in USD (${PAYOUT_MIN}–${PAYOUT_MAX}).`),
  zone_id: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Zone UUID for a zone-specific override. Omit for the global rule."),
  confirm: z.boolean().default(false).describe("false = dry-run preview (default). true = apply."),
};

type SetPayoutRuleArgs = {
  campaign_id: string | number;
  payout: number;
  zone_id?: string;
  confirm: boolean;
};

export async function setPayoutRule(
  client: AffsetClient,
  args: SetPayoutRuleArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    const zoneId = args.zone_id?.trim() || null;
    const scope = zoneId == null ? "global" : `zone \`${zoneId}\``;

    // The API stores payouts at 5 decimals; preview what will actually be stored.
    const payout = Math.round(args.payout * 100000) / 100000;

    const existing = findPayoutRule(await fetchPayoutRules(client, campaignId), zoneId);
    const changes = buildChanges(existing, payout);

    if (existing && changes.length === 0) {
      return textResult(
        `Nothing to change — ${scope} payout on campaign \`${campaignId}\` ` +
          `is already ${moneyPrecise(payout)}.`,
      );
    }

    if (!args.confirm) {
      const head = existing
        ? `**Dry run** — would replace ${scope} payout on campaign \`${campaignId}\`.`
        : `**Dry run** — would create ${scope} payout on campaign \`${campaignId}\`.`;
      return textResult(
        [
          head,
          "",
          renderDiff(changes),
          ...(payout !== args.payout
            ? ["", `_Rounded ${args.payout} → ${payout} (the API stores 5 decimals)._`]
            : []),
          "",
          "Call again with `confirm: true` to apply.",
        ].join("\n"),
      );
    }

    if (!existing) {
      const created = await createPayoutRule(client, campaignId, zoneId, payout);
      return textResult(
        [
          `✅ Created ${scope} payout on campaign \`${campaignId}\` (rule id \`${created.id}\`).`,
          "",
          renderDiff(changes),
        ].join("\n"),
      );
    }

    const result = await replacePayout(client, campaignId, zoneId, existing, payout);

    if ("lost" in result) {
      return textError(
        [
          `❌ Campaign \`${campaignId}\` now has **no ${scope} payout rule** — every ` +
            "conversion on that scope resolves to $0 until one is set.",
          "",
          `The old rule (${moneyPrecise(result.lost.payout)}) was deleted, the new payout ` +
            "failed to save, and restoring the old one failed too.",
          "",
          `- new payout: ${describeCause(result.cause)}`,
          `- restore: ${describeCause(result.rollbackCause)}`,
          "",
          "Re-run this tool with `confirm: true` to set the payout again.",
        ].join("\n"),
      );
    }

    if ("rolledBack" in result) {
      return textError(
        [
          `❌ Could not set ${scope} payout on campaign \`${campaignId}\`: ` +
            describeCause(result.cause),
          "",
          `The previous payout (${moneyPrecise(result.rolledBack.payout)}) was restored — ` +
            "nothing is serving at $0.",
        ].join("\n"),
      );
    }

    return textResult(
      [
        `✅ Replaced ${scope} payout on campaign \`${campaignId}\` (rule id \`${result.rule.id}\`).`,
        "",
        renderDiff(changes),
      ].join("\n"),
    );
  } catch (err) {
    if (err instanceof AffsetApiError && err.status === 404) {
      return textError(
        `Campaign \`${String(args.campaign_id).trim()}\` not found (or zone does not exist).`,
      );
    }
    return errorResult(err);
  }
}

function describeCause(err: unknown): string {
  if (err instanceof AffsetApiError) return `affset API error (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function buildChanges(existing: PayoutRule | undefined, payout: number): FieldChange[] {
  if (!existing) {
    return [{ field: "payout", from: displayValue(null), to: moneyPrecise(payout) }];
  }
  if (existing.payout === payout) return [];
  return [{ field: "payout", from: moneyPrecise(existing.payout), to: moneyPrecise(payout) }];
}
