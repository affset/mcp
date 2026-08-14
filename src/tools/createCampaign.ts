import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import type { Config } from "../runtimeConfig.js";
import { mdCell, moneyPrecise } from "../lib/format.js";
import { buildTrackingLink, fetchTenantIntegration } from "../lib/integrationUrls.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import { httpUrlError } from "../lib/urls.js";
import { resolveZone, zonePostbackNote } from "../lib/zones.js";
import { type CreateCampaignResponse } from "../types.js";

/** Geo targeting-rule-type id (matches the core migration seed). */
const GEO_RULE_TYPE_ID = 1;

/** Matches lite-adserver PAYOUT_MIN / PAYOUT_MAX. */
const PAYOUT_MIN = 0.00001;
const PAYOUT_MAX = 9999.99999;

const NAME_MAX = 120;

export const CREATE_CAMPAIGN_DESCRIPTION =
  "Create a campaign (offer) in the current namespace from a compact spec: advertiser " +
  "email, offer URL, geo whitelist, payout, name. The advertiser (user_email) is required " +
  "— it must already exist as a team member (same as the Advertiser dropdown in the dashboard); " +
  "create one first with create_team_member if needed. " +
  "Everything else gets media-buying defaults: CPA model, " +
  "rate 0 (no internal advertiser billing), created paused, a global payout rule when " +
  "payout is given, and a ready-to-use tracking link prefilled with the sub convention " +
  "(source_click_id + sub1..sub5, named by the tenant's sub labels). The campaign is " +
  "created paused, so activate it before sending traffic through either URL. " +
  "Geo whitelist applies to /serve rotation only; the tracking link itself is not geo-gated. " +
  "DRY-RUN by default; pass confirm=true to apply. No money is spent by this call; the " +
  "result echoes exactly what was created.";

export const createCampaignInputSchema = {
  user_email: z
    .string()
    .trim()
    .email()
    .describe(
      "Advertiser email that owns this campaign (required — the API rejects the call without it). " +
        "Must already exist as a team member with the advertiser role; same as the dashboard's " +
        "Advertiser dropdown. List candidates with list_team, or create one with create_team_member.",
    ),
  offer_url: z
    .string()
    .min(1)
    .describe(
      "Offer / lander URL the click redirects to. May carry {click_id} (affset's click id, " +
        "for S2S postback back into affset) and {sub1}..{sub5} macros.",
    ),
  name: z
    .string()
    .min(1)
    .max(NAME_MAX)
    .optional()
    .describe("Campaign name / funnel tag. Default: derived from offer host, geo and payout."),
  geo: z
    .array(z.string().length(2))
    .nonempty()
    .optional()
    .describe(
      'Geo whitelist as ISO 3166-1 alpha-2 codes, e.g. ["BR"] or ["BR","MX"]. Omit for worldwide. ' +
        "Applies to /serve rotation only — the tracking link is not geo-gated.",
    ),
  payout: z
    .number()
    .min(PAYOUT_MIN)
    .max(PAYOUT_MAX)
    .optional()
    .describe(
      `Offer payout per conversion in USD (${PAYOUT_MIN}–${PAYOUT_MAX}; creates the campaign's global payout rule).`,
    ),
  zone_id: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Traffic-source zone for the tracking link. Optional when the namespace has exactly " +
        "one active zone — it is picked automatically; otherwise the tool lists zones to choose from.",
    ),
  confirm: z
    .boolean()
    .default(false)
    .describe("false = dry-run preview (default). true = create the campaign."),
};

type CreateCampaignArgs = {
  user_email: string;
  offer_url: string;
  name?: string;
  geo?: string[];
  payout?: number;
  zone_id?: string;
  confirm: boolean;
};

export async function createCampaign(
  client: AffsetClient,
  config: Config,
  args: CreateCampaignArgs,
): Promise<CallToolResult> {
  try {
    // 1. Validate the compact spec locally (clear errors beat API 400s).
    const urlErr = httpUrlError(args.offer_url, "offer_url");
    if (urlErr) return textError(urlErr);
    const offerUrl = new URL(args.offer_url);

    const geo = normalizeGeo(args.geo);
    if ("error" in geo) return textError(geo.error);
    const geoCodes = geo.codes;

    // 2. Resolve zone + tenant integration settings (link base, sub labels) in parallel.
    //    Safe for dry-run — both are reads.
    const [zoneResult, integration] = await Promise.all([
      resolveZone(client, args.zone_id),
      fetchTenantIntegration(client, config),
    ]);
    if ("error" in zoneResult) {
      return textError(zoneResult.error);
    }
    const { zone, inactiveWarning } = zoneResult;

    const name = args.name?.trim() || defaultName(offerUrl, geoCodes, args.payout);
    const geoNote = geoCodes.length
      ? `${geoCodes.join(", ")} (whitelist; enforced on /serve, not on the tracking link)`
      : "worldwide (no geo rule)";
    const payoutPreview =
      args.payout !== undefined
        ? `${moneyPrecise(args.payout)} per conversion (global rule)`
        : "_none set — add one to track revenue and use {payout} in postbacks_";

    const summaryTable = [
      "| Field | Value |",
      "|---|---|",
      `| Name | ${mdCell(name)} |`,
      `| Advertiser | ${mdCell(args.user_email)} |`,
      `| Offer URL | ${mdCell(args.offer_url)} |`,
      `| Geo | ${geoNote} |`,
      `| Payout | ${payoutPreview} |`,
      `| Model | CPA, rate 0 (defaults — no internal advertiser billing) |`,
      `| Status | paused (activate before sending traffic through either URL) |`,
      `| Zone | ${mdCell(zone.name)} (\`${zone.id}\`) — ${zonePostbackNote(zone)} |`,
    ].join("\n");

    if (!args.confirm) {
      return textResult(
        [
          "**Dry run** — would create a campaign with:",
          "",
          summaryTable,
          ...(inactiveWarning ? ["", inactiveWarning] : []),
          "",
          "Call again with `confirm: true` to create it. The tracking link is returned after create.",
        ].join("\n"),
      );
    }

    // 3. Create the campaign with media-buying defaults. rate stays 0 so internal
    //    advertiser billing/budget enforcement is untouched; revenue comes from the
    //    payout rule. The API forces status=paused on create.
    const created = await client.post<CreateCampaignResponse>("/api/campaigns", {
      name,
      user_email: args.user_email.trim(),
      redirect_url: args.offer_url,
      payment_model: "cpa",
      rate: 0,
      start_date: Date.now(),
      targeting_rules: geoCodes.length
        ? [
            {
              targeting_rule_type_id: GEO_RULE_TYPE_ID,
              targeting_method: "whitelist",
              rule: geoCodes.join(","),
            },
          ]
        : [],
    });

    // 4. Global payout rule (zone_id null). Failure here must not hide the created
    //    campaign — report it as a warning instead of failing the whole call.
    let payoutNote = "_none set — add one to track revenue and use {payout} in postbacks_";
    if (args.payout !== undefined) {
      try {
        await client.post(`/api/campaigns/${created.id}/payout_rules`, { payout: args.payout });
        payoutNote = `${moneyPrecise(args.payout)} per conversion (global rule)`;
      } catch (err) {
        const message = err instanceof AffsetApiError ? err.message : String(err);
        payoutNote = `⚠️ campaign created, but setting the payout rule failed: ${message}`;
      }
    }

    // 5. Ready-to-paste tracking link with the sub convention prefilled.
    const trackingLink = buildTrackingLink(integration.baseUrl, created.id, zone.id, {
      subLabels: integration.subLabels,
    });

    return textResult(
      [
        `✅ Campaign **${mdCell(created.name)}** created (id \`${created.id}\`).`,
        "",
        "| Field | Value |",
        "|---|---|",
        `| Advertiser | ${mdCell(args.user_email)} |`,
        `| Offer URL | ${mdCell(args.offer_url)} |`,
        `| Geo | ${geoNote} |`,
        `| Payout | ${payoutNote} |`,
        `| Model | CPA, rate 0 (defaults — no internal advertiser billing) |`,
        `| Status | ${created.status || "paused"} (activate before sending traffic through either URL) |`,
        `| Zone | ${mdCell(zone.name)} (\`${zone.id}\`) — ${zonePostbackNote(zone)} |`,
        ...(inactiveWarning ? ["", inactiveWarning] : []),
        "",
        "**Tracking link** (give this to the traffic source):",
        "```",
        trackingLink,
        "```",
        "Replace each `{…}` placeholder with the source's macro; `{clickid}` is already " +
          "correct for RichAds. Drop sub slots you don't need. Append `&cost={cost}` " +
          "(the network's cost macro) to import media cost for ROI. This link returns " +
          "404 while the campaign is paused; run it with `set_campaign_status` before use.",
        "",
        "_Only defaults were set — use `set_targeting_rule`, `set_payout_rule`, and budget fields on `update_campaign` for the rest._",
        "_Need this link again later, or the rotating /serve URL instead? `get_tracking_link` / `get_zone_url`._",
      ].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}

function normalizeGeo(raw: string[] | undefined): { codes: string[] } | { error: string } {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw ?? []) {
    const code = entry.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) {
      return { error: `geo entries must be 2-letter ISO country codes, got "${entry}".` };
    }
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return { codes };
}

/** "offer.com BR $2" — a name the buyer can recognise in a list without opening it. */
function defaultName(offerUrl: URL, geo: string[], payout?: number): string {
  const parts = [offerUrl.hostname.replace(/^www\./, "")];
  if (geo.length) parts.push(geo.join("+"));
  if (payout !== undefined) parts.push(moneyPrecise(payout).replace(/\.?0+$/, ""));
  const name = parts.join(" ");
  return name.length <= NAME_MAX ? name : `${name.slice(0, NAME_MAX - 1)}…`;
}
