import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import type { Config } from "../runtimeConfig.js";
import { mdCell } from "../lib/format.js";
import { buildZoneUrl, fetchTenantIntegration, subLegend } from "../lib/integrationUrls.js";
import { collectSubs, linkInputSchema, type LinkArgs } from "../lib/linkArgs.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import { resolveZone, zonePostbackNote } from "../lib/zones.js";
import type { CampaignsResponse } from "../types.js";

export const GET_ZONE_URL_DESCRIPTION =
  "Get the zone URL to paste into a traffic source's campaign settings — the /serve link " +
  "that rotates across the zone's active campaigns. Prefilled with the sub convention " +
  "(source_click_id + sub1..sub5) and optionally the network's cost macro. Uses the " +
  "tenant's custom API domain when one is set. Read-only: builds the URL, changes nothing. " +
  "For a link straight to one active campaign without targeting checks, use " +
  "get_tracking_link instead.";

export const getZoneUrlInputSchema = {
  zone_id: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Zone to build the URL for. Optional when the namespace has exactly one active " +
        "zone — it is picked automatically; otherwise the tool lists zones to choose from.",
    ),
  ...linkInputSchema,
};

type GetZoneUrlArgs = LinkArgs & { zone_id?: string };

export async function getZoneUrl(
  client: AffsetClient,
  config: Config,
  args: GetZoneUrlArgs,
): Promise<CallToolResult> {
  try {
    const [zoneResult, integration] = await Promise.all([
      resolveZone(client, args.zone_id),
      fetchTenantIntegration(client, config),
    ]);
    if ("error" in zoneResult) return textError(zoneResult.error);
    const { zone, inactiveWarning } = zoneResult;

    const subs = collectSubs(args);
    const url = buildZoneUrl(integration.baseUrl, zone.id, {
      sourceClickId: args.source_click_id,
      subs,
      cost: args.cost,
      subLabels: integration.subLabels,
    });

    // A zone URL with nothing to rotate serves the traffic-back / unsold path — the
    // single most common "my link doesn't work" report, so check it up front.
    const rotationNote = await describeRotation(client);
    const legend = subLegend(integration.subLabels, subs);

    return textResult(
      [
        `**Zone URL** for **${mdCell(zone.name)}** (\`${zone.id}\`) — give this to the traffic source:`,
        "",
        "```",
        url,
        "```",
        "",
        "| Field | Value |",
        "|---|---|",
        `| Zone status | ${zone.status} |`,
        `| Rotation | ${rotationNote} |`,
        `| Postback | ${zonePostbackNote(zone)} |`,
        `| Traffic back | ${mdCell(zone.traffic_back_url ?? "—")} |`,
        ...(legend ? [`| Sub slots | ${legend} |`] : []),
        ...(inactiveWarning ? ["", inactiveWarning] : []),
        "",
        "Replace each `{…}` placeholder with the source's own macro and drop the sub slots " +
          "you don't need. Values are inserted verbatim — the network expands its macros " +
          "before the request reaches affset.",
        args.cost
          ? "`cost` is recorded once per /serve, on the impression row — don't also add it to a tracking link for the same traffic."
          : "Add `cost=<network cost macro>` to import media cost and get ROI in `get_stats`.",
        "",
        "_This URL rotates across the zone's **active** campaigns. For a link that goes " +
          "straight to one active campaign without applying targeting rules, use `get_tracking_link`._",
      ].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}

/** Cheap active-campaign count; degrades to a neutral note rather than failing. */
async function describeRotation(client: AffsetClient): Promise<string> {
  try {
    const res = await client.get<CampaignsResponse>("/api/campaigns", {
      status: "active",
      limit: 1,
    });
    const total = res.pagination?.total ?? res.campaigns?.length ?? 0;
    if (total === 0) {
      return (
        "⚠️ **no active campaigns visible to this API key** — if its campaign scope is " +
        "complete, this URL will serve traffic back / unsold until one is running " +
        "(`set_campaign_status` action=run)"
      );
    }
    return (
      `${total} active campaign${total === 1 ? "" : "s"} visible; ` +
      "targeting, dates, pacing and budgets decide request-time eligibility"
    );
  } catch {
    return "could not read active campaigns";
  }
}
