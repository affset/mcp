/**
 * Zone lookup shared by every tool that needs a traffic source: campaign creation
 * and both integration-URL tools all take an optional `zone_id` and auto-pick when
 * the namespace has exactly one active zone.
 */

import { AffsetApiError, type AffsetClient } from "../client.js";
import { mdCell } from "./format.js";
import type { Zone, ZonesResponse } from "../types.js";

const ZONE_CHOICES_LIMIT = 25;

export type ResolvedZone = { zone: Zone; inactiveWarning?: string };
export type ZoneResolution = ResolvedZone | { error: string };

/**
 * Resolve the zone to build URLs against. An explicit id is fetched directly — the
 * paginated list must not be the arbiter of whether a zone exists.
 */
export async function resolveZone(
  client: AffsetClient,
  zoneId: string | undefined,
): Promise<ZoneResolution> {
  if (zoneId !== undefined) {
    const explicitId = zoneId.trim();
    if (!explicitId) return { error: "zone_id cannot be blank." };
    try {
      const zone = await client.get<Zone>(`/api/zones/${encodeURIComponent(explicitId)}`);
      if (zone.status !== "active") {
        return {
          zone,
          inactiveWarning:
            `⚠️ Zone \`${zone.id}\` is **${zone.status}** — both /serve and direct ` +
            "/track/click URLs return 404 until the zone is reactivated.",
        };
      }
      return { zone };
    } catch (err) {
      if (err instanceof AffsetApiError && err.status === 404) {
        return { error: `Zone \`${explicitId}\` not found in this namespace.` };
      }
      throw err;
    }
  }

  const { zones: active, total } = await listActiveZones(client);
  if (total === 1 && active.length === 1) {
    return { zone: active[0] };
  }
  if (total === 0) {
    return {
      error:
        "No active zones in this namespace. Create a zone for the traffic source first " +
        "(its postback_url is where conversions are reported back), then pass its id as zone_id.",
    };
  }
  return {
    error: `Multiple active zones — pass zone_id to pick the traffic source:\n${zoneList(active, total)}`,
  };
}

/** One filtered page is enough to auto-pick or show a bounded choice list. */
async function listActiveZones(client: AffsetClient): Promise<{ zones: Zone[]; total: number }> {
  const res = await client.get<ZonesResponse>("/api/zones", {
    status: "active",
    limit: ZONE_CHOICES_LIMIT,
    offset: 0,
    sort: "name",
    order: "asc",
  });
  const zones = (res.zones ?? []).filter((zone) => zone.status === "active");
  return { zones, total: res.pagination?.total ?? zones.length };
}

function zoneList(zones: Zone[], total: number): string {
  const lines = zones.map(
    (z) => `- \`${z.id}\` — ${mdCell(z.name)}${z.postback_url ? "" : " (no postback URL)"}`,
  );
  if (total > zones.length) {
    lines.push(`- …and ${total - zones.length} more`);
  }
  return lines.join("\n");
}

/**
 * The line every integration URL needs under it: without a postback URL on the zone,
 * conversions never make it back to the traffic source and its optimizer stays blind.
 */
export function zonePostbackNote(zone: Zone): string {
  if (!zone.postback_url) {
    return (
      "⚠️ no postback URL on this zone — set one with `update_zone` (include " +
      "`{source_click_id}`) or the source will not see conversions"
    );
  }
  if (!zone.postback_url.includes("{source_click_id}")) {
    return `${mdCell(zone.postback_url)} — ⚠️ missing \`{source_click_id}\`, conversions cannot be attributed back`;
  }
  return "postback URL configured — conversions will be reported to the source";
}
