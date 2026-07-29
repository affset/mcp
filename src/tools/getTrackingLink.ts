import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import type { Config } from "../config.js";
import { mdCell } from "../lib/format.js";
import { buildTrackingLink, fetchTenantIntegration, subLegend } from "../lib/integrationUrls.js";
import { collectSubs, linkInputSchema, type LinkArgs } from "../lib/linkArgs.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import { resolveZone, zonePostbackNote } from "../lib/zones.js";
import type { Campaign } from "../types.js";

export const GET_TRACKING_LINK_DESCRIPTION =
  "Get the tracking link for an existing campaign + zone — the /track/click link that goes " +
  "straight to that one campaign with no rotation or targeting checks. Both the campaign " +
  "and zone must be active for the public link to work. Same link create_campaign echoes on " +
  "create; this re-derives it later, for any " +
  "campaign, with whatever sub values you want. Uses the tenant's custom API domain when " +
  "one is set. Read-only: builds the URL, changes nothing.";

export const getTrackingLinkInputSchema = {
  campaign_id: z
    .union([
      z
        .string()
        .trim()
        .regex(/^[1-9]\d*$/, "campaign_id must be a positive integer")
        .refine((value) => Number.isSafeInteger(Number(value)), "campaign_id is too large"),
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ])
    .describe("Campaign the link should send traffic to."),
  zone_id: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Traffic-source zone to attribute the clicks to. Optional when the namespace has " +
        "exactly one active zone — it is picked automatically.",
    ),
  ...linkInputSchema,
};

type GetTrackingLinkArgs = LinkArgs & {
  campaign_id: string | number;
  zone_id?: string;
};

export async function getTrackingLink(
  client: AffsetClient,
  config: Config,
  args: GetTrackingLinkArgs,
): Promise<CallToolResult> {
  try {
    const [campaignResult, zoneResult, integration] = await Promise.all([
      fetchCampaign(client, args.campaign_id),
      resolveZone(client, args.zone_id),
      fetchTenantIntegration(client, config),
    ]);
    if ("error" in campaignResult) return textError(campaignResult.error);
    if ("error" in zoneResult) return textError(zoneResult.error);
    const { campaign } = campaignResult;
    const { zone, inactiveWarning } = zoneResult;

    const subs = collectSubs(args);
    const url = buildTrackingLink(integration.baseUrl, campaign.id, zone.id, {
      sourceClickId: args.source_click_id,
      subs,
      cost: args.cost,
      subLabels: integration.subLabels,
    });

    const legend = subLegend(integration.subLabels, subs);
    const statusNote =
      campaign.status === "active"
        ? "active — serving still depends on dates and budget state; also a /serve candidate"
        : campaign.status === "paused"
          ? "⚠️ paused — this link returns 404 until the campaign is run"
          : `⚠️ ${campaign.status} — this link is unavailable until the campaign is active`;
    const availabilityWarnings = campaignAvailabilityWarnings(campaign);

    return textResult(
      [
        `**Tracking link** for **${mdCell(campaign.name)}** (\`${campaign.id}\`) via zone **${mdCell(zone.name)}** (\`${zone.id}\`):`,
        "",
        "```",
        url,
        "```",
        "",
        "| Field | Value |",
        "|---|---|",
        `| Campaign status | ${statusNote} |`,
        `| Offer URL | ${mdCell(campaign.redirect_url ?? "—")} |`,
        `| Zone status | ${zone.status} |`,
        `| Postback | ${zonePostbackNote(zone)} |`,
        ...(legend ? [`| Sub slots | ${legend} |`] : []),
        ...(availabilityWarnings.length ? ["", ...availabilityWarnings] : []),
        ...(inactiveWarning ? ["", inactiveWarning] : []),
        "",
        "Replace each `{…}` placeholder with the source's own macro and drop the sub slots " +
          "you don't need. Values are inserted verbatim — the network expands its macros " +
          "before the request reaches affset.",
        args.cost
          ? "`cost` is recorded on the click row here. Use it on this link **or** on a zone URL for the same traffic, never both."
          : "Add `cost=<network cost macro>` to import media cost and get ROI in `get_stats`.",
        "",
        "_Geo and other targeting rules are enforced in /serve rotation only — this link is " +
          "not geo-gated. Use `get_zone_url` when you want affset to pick the campaign._",
      ].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}

function campaignAvailabilityWarnings(campaign: Campaign): string[] {
  const warnings: string[] = [];
  const now = Date.now();
  if (campaign.budget_paused) {
    warnings.push(
      "⚠️ The campaign is budget-paused and may be absent from the active-serving cache.",
    );
  }
  if (campaign.start_date != null && campaign.start_date > now) {
    warnings.push(
      `⚠️ The campaign starts at ${new Date(campaign.start_date).toISOString()}; the link is unavailable before then.`,
    );
  }
  if (campaign.end_date != null && campaign.end_date < now) {
    warnings.push(
      `⚠️ The campaign ended at ${new Date(campaign.end_date).toISOString()}; the link is unavailable.`,
    );
  }
  return warnings;
}

async function fetchCampaign(
  client: AffsetClient,
  campaignId: string | number,
): Promise<{ campaign: Campaign } | { error: string }> {
  try {
    const campaign = await client.get<Campaign>(
      `/api/campaigns/${encodeURIComponent(String(campaignId))}`,
    );
    return { campaign };
  } catch (err) {
    if (err instanceof AffsetApiError && err.status === 404) {
      return { error: `Campaign \`${campaignId}\` not found in this namespace.` };
    }
    throw err;
  }
}
