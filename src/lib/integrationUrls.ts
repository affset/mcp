/**
 * The two URLs a media buyer hands to a traffic source, and the base they hang off.
 *
 * - **Zone URL** — `/serve/{zone_id}`. The network sends traffic here and affset
 *   picks a campaign out of the zone's rotation (active campaigns only).
 * - **Tracking link** — `/track/click/{campaign_id}/{zone_id}`. Straight to one
 *   campaign, no rotation and no targeting checks. The campaign and zone still have
 *   to be active because the public tracking path reads the active-serving cache.
 *
 * Both carry the same query convention: `source_click_id` (the network's own click
 * token, echoed back on postback) plus the five analytics sub slots.
 */

import type { AffsetClient } from "../client.js";
import type { Config } from "../config.js";
import { SUB_KEYS, type SubKey, type SubLabels, type TenantSettingsResponse } from "../types.js";
import { mdCell } from "./format.js";

/** Query parameter carrying the traffic source's click token. */
export const SOURCE_CLICK_ID_PARAM = "source_click_id";

/**
 * Default click-token macro. RichAds' spelling — the pilot source; other networks
 * substitute their own (`[CLICK_ID]`, `${SUBID}`, …).
 */
export const DEFAULT_SOURCE_CLICK_ID = "{clickid}";

export type SubValues = Partial<Record<SubKey, string>>;

/** Everything needed to build integration URLs, from a single `/api/tenant` read. */
export interface TenantIntegration {
  /** Origin the network will actually be pointed at (custom API domain when set). */
  baseUrl: string;
  subLabels: SubLabels;
}

/**
 * Resolve the origin for URLs that leave the building. A tenant with a custom API
 * domain must see that domain: these URLs get pasted into a network's campaign
 * settings, so they have to be the final ones.
 *
 * Never fails — the links matter more than the branding, so a bad or unreadable
 * setting falls back to the configured API base.
 */
export async function fetchTenantIntegration(
  client: AffsetClient,
  config: Config,
): Promise<TenantIntegration> {
  try {
    const settings = await client.get<TenantSettingsResponse>("/api/tenant");
    return {
      baseUrl: integrationBaseUrl(settings.custom_api_domain, config.baseUrl),
      subLabels: settings.sub_labels ?? {},
    };
  } catch {
    return { baseUrl: stripTrailingSlash(config.baseUrl), subLabels: {} };
  }
}

/** `custom_api_domain` is tenant-editable free text — only use it if it parses. */
export function integrationBaseUrl(
  customApiDomain: string | null | undefined,
  fallback: string,
): string {
  const domain = customApiDomain?.trim();
  if (!domain) return stripTrailingSlash(fallback);

  // A non-http scheme has to be rejected, not papered over: prefixing "https://"
  // onto "ftp://files.example.com" parses as host "ftp" with the rest as the path,
  // which would silently hand the network "https://ftp".
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(domain)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") {
    return stripTrailingSlash(fallback);
  }

  try {
    const parsed = new URL(scheme ? domain : `https://${domain}`);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search ||
      parsed.hash
    ) {
      return stripTrailingSlash(fallback);
    }
    return stripTrailingSlash(parsed.origin);
  } catch {
    return stripTrailingSlash(fallback);
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export interface LinkParams {
  /** Click-token macro. Omit for the RichAds default; pass "" to leave it out. */
  sourceClickId?: string;
  /** Explicit sub values; unset slots fall back to a label-derived placeholder. */
  subs?: SubValues;
  /** Network cost macro for `?cost=`. Omitted when absent. */
  cost?: string;
  subLabels?: SubLabels;
}

/** `/serve/{zone_id}` — the zone URL, for campaign rotation. */
export function buildZoneUrl(baseUrl: string, zoneId: string, params: LinkParams = {}): string {
  return withQuery(`${stripTrailingSlash(baseUrl)}/serve/${encodeURIComponent(zoneId)}`, params);
}

/** `/track/click/{campaign_id}/{zone_id}` — straight to one campaign. */
export function buildTrackingLink(
  baseUrl: string,
  campaignId: number | string,
  zoneId: string,
  params: LinkParams = {},
): string {
  const path = `/track/click/${encodeURIComponent(String(campaignId))}/${encodeURIComponent(zoneId)}`;
  return withQuery(`${stripTrailingSlash(baseUrl)}${path}`, params);
}

/**
 * Values go in verbatim, not percent-encoded: what these carry are the traffic
 * source's own macros (`{clickid}`, `[CLICK_ID]`, `${SUBID}`), which the source
 * expands before the request ever reaches affset. Encoding them would hand the
 * network a URL it cannot substitute into.
 *
 * `source_click_id` leads — it is what conversion postbacks depend on, so it should
 * read as the primary parameter in the copied URL. All five sub slots are emitted as
 * a template for the buyer to fill in or delete.
 */
function withQuery(
  base: string,
  { sourceClickId = DEFAULT_SOURCE_CLICK_ID, subs = {}, cost, subLabels = {} }: LinkParams,
): string {
  const parts: string[] = [];

  const clickId = sourceClickId.trim();
  if (clickId) parts.push(`${SOURCE_CLICK_ID_PARAM}=${clickId}`);

  for (const key of SUB_KEYS) {
    const explicit = subs[key]?.trim();
    parts.push(`${key}=${explicit || `{${placeholderName(key, subLabels[key])}}`}`);
  }

  const costMacro = cost?.trim();
  if (costMacro) parts.push(`cost=${costMacro}`);

  return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}

/** "Creative name" -> `creative_name`; falls back to the raw sub key. */
export function placeholderName(key: string, label: string | undefined): string {
  const slug = (label ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");
  return slug || key;
}

/** "sub1 = Creative, sub2 = Placement" — so the buyer can see what belongs where. */
export function subLegend(subLabels: SubLabels, subs: SubValues = {}): string | null {
  const labelled = SUB_KEYS.flatMap((key) => {
    const value = subs[key]?.trim();
    const label = subLabels[key]?.trim();
    if (!value && !label) return [];
    return value
      ? [`\`${key}\` = ${mdCell(value)}${label ? ` (${mdCell(label)})` : ""}`]
      : [`\`${key}\` = ${mdCell(label!)}`];
  });
  return labelled.length > 0 ? labelled.join(" · ") : null;
}
