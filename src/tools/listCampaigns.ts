import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { mdCell, money } from "../lib/format.js";
import { errorResult } from "../lib/toolResult.js";
import { CAMPAIGN_STATUSES, type Campaign, type CampaignsResponse } from "../types.js";

export const LIST_CAMPAIGNS_DESCRIPTION =
  "List campaigns in the current namespace. Filter by status and optionally by name " +
  "(client-side contains match — the API has no search). Returns id, name, status, " +
  "offer URL, model/rate, advertiser, budgets. Paginated (default 20, max 100).";

export const listCampaignsInputSchema = {
  status: z.enum(CAMPAIGN_STATUSES).optional().describe("Filter by campaign status."),
  name_contains: z
    .string()
    .min(1)
    .optional()
    .describe("Case-insensitive substring match on campaign name (client-side)."),
  limit: z.number().int().min(1).max(100).default(20).describe("Page size (1–100). Default 20."),
  offset: z.number().int().min(0).default(0).describe("Pagination offset. Default 0."),
  sort: z
    .enum(["name", "created_at", "start_date"])
    .default("created_at")
    .describe("Sort field. Default created_at."),
  order: z.enum(["asc", "desc"]).default("desc").describe("Sort order. Default desc."),
};

type ListCampaignsArgs = {
  status?: (typeof CAMPAIGN_STATUSES)[number];
  name_contains?: string;
  limit: number;
  offset: number;
  sort: "name" | "created_at" | "start_date";
  order: "asc" | "desc";
};

export async function listCampaigns(
  client: AffsetClient,
  args: ListCampaignsArgs,
): Promise<CallToolResult> {
  try {
    const data = await client.get<CampaignsResponse>("/api/campaigns", {
      status: args.status,
      limit: args.limit,
      offset: args.offset,
      sort: args.sort,
      order: args.order,
    });

    let campaigns = data.campaigns ?? [];
    const needle = args.name_contains?.trim().toLowerCase();
    if (needle) {
      campaigns = campaigns.filter((c) => c.name.toLowerCase().includes(needle));
    }

    const pagination = data.pagination;
    const total = pagination?.total ?? campaigns.length;
    const shown = campaigns.length;
    const filterNote = needle
      ? ` (name contains "${args.name_contains}" → ${shown} on this page)`
      : "";

    const head =
      `**Campaigns** — showing ${shown} of total ${total}${filterNote}` +
      (pagination?.has_more ? `. More available (offset ${args.offset + args.limit}).` : ".");

    return {
      content: [{ type: "text", text: `${head}\n\n${renderTable(campaigns)}` }],
    };
  } catch (err) {
    return errorResult(err);
  }
}

function renderTable(campaigns: Campaign[]): string {
  if (campaigns.length === 0) return "_No campaigns matched._";
  const lines = [
    "| ID | Name | Status | Model | Rate | Offer | Advertiser | Budget |",
    "|--:|---|---|---|--:|---|---|---|",
  ];
  for (const c of campaigns) {
    const budget = formatBudget(c);
    lines.push(
      `| ${c.id} | ${mdCell(c.name)} | ${c.status} | ${c.payment_model ?? "—"} | ${
        c.rate ?? "—"
      } | ${mdCell(shortUrl(c.redirect_url))} | ${mdCell(c.user_email ?? "—")} | ${budget} |`,
    );
  }
  return lines.join("\n");
}

function formatBudget(c: Campaign): string {
  const parts: string[] = [];
  if (c.daily_budget != null) parts.push(`daily ${money(c.daily_budget)}`);
  if (c.total_budget != null) parts.push(`total ${money(c.total_budget)}`);
  if (c.budget_paused) parts.push(`paused:${c.budget_pause_reason ?? "?"}`);
  return parts.length ? parts.join(", ") : "—";
}

function shortUrl(url: string | null | undefined): string {
  if (!url) return "—";
  return url.length > 48 ? `${url.slice(0, 45)}…` : url;
}
