import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { displayValue, renderDiff } from "../lib/patch.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import type { Campaign, UpdateCampaignResponse } from "../types.js";

export const SET_PAYOUT_GOAL_DESCRIPTION =
  "Set or clear a campaign's payout_goal_type (goal-based conversions). When set, " +
  "spend and payout apply only when the conversion pixel's `type=` exactly matches; " +
  "other types are still recorded with $0. Pass null (or empty string) to clear. " +
  "DRY-RUN by default; pass confirm=true to apply.";

export const setPayoutGoalInputSchema = {
  campaign_id: z
    .union([z.string().min(1), z.number().int()])
    .describe("Campaign to set the payout goal type on."),
  goal_type: z
    .union([z.string(), z.null()])
    .describe('Goal type string (e.g. "deposit", "lead", "purchase"), or null/"" to clear.'),
  confirm: z.boolean().default(false).describe("false = dry-run preview (default). true = apply."),
};

type SetPayoutGoalArgs = {
  campaign_id: string | number;
  goal_type: string | null;
  confirm: boolean;
};

export async function setPayoutGoal(
  client: AffsetClient,
  args: SetPayoutGoalArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    const next = args.goal_type == null ? null : args.goal_type.trim() || null;

    let existing: Campaign;
    try {
      existing = await client.get<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}`);
    } catch (err) {
      if (err instanceof AffsetApiError && err.status === 404) {
        return textError(`Campaign \`${campaignId}\` not found in this namespace.`);
      }
      throw err;
    }

    const from = existing.payout_goal_type?.trim() || null;
    if (from === next) {
      return textResult(
        `Nothing to change on campaign \`${existing.id}\` (${mdCell(existing.name)}) — ` +
          `payout_goal_type is already ${displayValue(from)}.`,
      );
    }

    const diff = renderDiff([
      {
        field: "payout_goal_type",
        from: displayValue(from),
        to: displayValue(next),
      },
    ]);

    if (!args.confirm) {
      return textResult(
        [
          `**Dry run** — would update payout_goal_type on campaign \`${existing.id}\` (${mdCell(existing.name)}).`,
          "",
          diff,
          "",
          next
            ? `⚠️ Only conversions with pixel \`type=${next}\` will get spend/payout; others stay $0.`
            : "Clearing the goal type means every conversion type gets the resolved payout.",
          "",
          "Call again with `confirm: true` to apply.",
        ].join("\n"),
      );
    }

    await client.put<UpdateCampaignResponse>(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
      payout_goal_type: next,
    });

    return textResult(
      [`✅ Campaign \`${existing.id}\` payout_goal_type updated.`, "", diff].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}
