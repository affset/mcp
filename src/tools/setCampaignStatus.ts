import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { updateCampaign } from "./updateCampaign.js";

/** Media-buyer verbs → API status. */
export const CAMPAIGN_ACTIONS = ["run", "pause"] as const;

const ACTION_TO_STATUS = {
  run: "active",
  pause: "paused",
} as const;

export const SET_CAMPAIGN_STATUS_DESCRIPTION =
  "Run (activate) or pause a campaign. 'run' enters /serve zone rotation and counts " +
  "against the plan's active-campaign limit (402 if exceeded). 'pause' removes the " +
  "campaign from active serving, so both /serve selection and direct tracking links stop. DRY-RUN by " +
  "default; pass confirm=true to apply. For name/offer/budget edits use update_campaign.";

export const setCampaignStatusInputSchema = {
  campaign_id: z
    .union([z.string().min(1), z.number().int()])
    .describe("Campaign id to run or pause."),
  action: z
    .enum(CAMPAIGN_ACTIONS)
    .describe("run = active serving. pause = both /serve and direct tracking links stop."),
  confirm: z
    .boolean()
    .default(false)
    .describe("false = dry-run preview (default). true = apply the status change."),
};

type SetCampaignStatusArgs = {
  campaign_id: string | number;
  action: (typeof CAMPAIGN_ACTIONS)[number];
  confirm: boolean;
};

export async function setCampaignStatus(
  client: AffsetClient,
  args: SetCampaignStatusArgs,
): Promise<CallToolResult> {
  return updateCampaign(client, {
    campaign_id: args.campaign_id,
    status: ACTION_TO_STATUS[args.action],
    confirm: args.confirm,
  });
}
