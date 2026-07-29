import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { errorResult } from "../lib/toolResult.js";
import { ZONE_STATUSES, type Zone, type ZonesResponse } from "../types.js";

export const LIST_ZONES_DESCRIPTION =
  "List traffic-source zones in the current namespace. Filter by status and optionally " +
  "by name (client-side contains match). Returns id, name, status, postback_url, " +
  "site_url, publisher. Paginated (default 20, max 100).";

export const listZonesInputSchema = {
  status: z.enum(ZONE_STATUSES).optional().describe("Filter by zone status."),
  name_contains: z
    .string()
    .min(1)
    .optional()
    .describe("Case-insensitive substring match on zone name (client-side)."),
  limit: z.number().int().min(1).max(100).default(20).describe("Page size (1–100). Default 20."),
  offset: z.number().int().min(0).default(0).describe("Pagination offset. Default 0."),
  sort: z
    .enum(["name", "created_at", "site_url"])
    .default("created_at")
    .describe("Sort field. Default created_at."),
  order: z.enum(["asc", "desc"]).default("desc").describe("Sort order. Default desc."),
};

type ListZonesArgs = {
  status?: (typeof ZONE_STATUSES)[number];
  name_contains?: string;
  limit: number;
  offset: number;
  sort: "name" | "created_at" | "site_url";
  order: "asc" | "desc";
};

export async function listZones(
  client: AffsetClient,
  args: ListZonesArgs,
): Promise<CallToolResult> {
  try {
    const data = await client.get<ZonesResponse>("/api/zones", {
      status: args.status,
      limit: args.limit,
      offset: args.offset,
      sort: args.sort,
      order: args.order,
    });

    let zones = data.zones ?? [];
    const needle = args.name_contains?.trim().toLowerCase();
    if (needle) {
      zones = zones.filter((z) => z.name.toLowerCase().includes(needle));
    }

    const pagination = data.pagination;
    const total = pagination?.total ?? zones.length;
    const shown = zones.length;
    const filterNote = needle
      ? ` (name contains "${args.name_contains}" → ${shown} on this page)`
      : "";

    const head =
      `**Zones** — showing ${shown} of total ${total}${filterNote}` +
      (pagination?.has_more ? `. More available (offset ${args.offset + args.limit}).` : ".");

    return {
      content: [{ type: "text", text: `${head}\n\n${renderTable(zones)}` }],
    };
  } catch (err) {
    return errorResult(err);
  }
}

function renderTable(zones: Zone[]): string {
  if (zones.length === 0) return "_No zones matched._";
  const lines = [
    "| ID | Name | Status | Postback | Site | Publisher |",
    "|---|---|---|---|---|---|",
  ];
  for (const z of zones) {
    lines.push(
      `| \`${z.id}\` | ${mdCell(z.name)} | ${z.status} | ${
        z.postback_url ? mdCell(shortUrl(z.postback_url)) : "⚠️ none"
      } | ${mdCell(shortUrl(z.site_url))} | ${mdCell(z.user_email ?? "—")} |`,
    );
  }
  return lines.join("\n");
}

function shortUrl(url: string | null | undefined): string {
  if (!url) return "—";
  return url.length > 40 ? `${url.slice(0, 37)}…` : url;
}
