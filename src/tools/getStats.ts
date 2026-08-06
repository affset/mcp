import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { resolveRange, RANGE_PRESETS } from "../lib/time.js";
import { formatStatsTable, groupHeader } from "../lib/format.js";
import { errorResult } from "../lib/toolResult.js";
import { GROUP_BY_VALUES, SUB_KEYS, type GroupBy, type StatsResponse } from "../types.js";

export const GET_STATS_DESCRIPTION =
  "Pull affset traffic stats grouped by a single dimension. Returns impressions, clicks, " +
  "conversions, CR, payout, media cost and ROI as a table. Drill down by calling " +
  "repeatedly: first group_by=date or campaign_id, then narrow with filters " +
  "(campaign_ids, zone_ids, sub1..sub5, conversion_type, advertiser_email, publisher_email) " +
  "and change group_by (zone_id, sub1, ...). " +
  'Sub columns are titled with the tenant\'s configured labels (e.g. "Zone (sub1)") ' +
  "when set; group_by/filters always take the raw subN key. " +
  "conversion_type only matches conversion rows, so filtering by it zeroes impressions, clicks " +
  "and media cost — it narrows to conversions of that type, not clicks that led to one. " +
  "ROI is blank until traffic cost has been imported for the slice. " +
  "group_by=advertiser_email / publisher_email break down by team member; the API limits them " +
  "to owner/manager plus the matching side's manager role (403 otherwise). " +
  "advertiser_email / publisher_email are also standalone filters — narrow every row to one " +
  "advertiser's campaigns or one publisher's zones regardless of group_by, instead of breaking " +
  "every user out into its own row. Same role limits as the matching group_by value.";

export const getStatsInputSchema = {
  group_by: z
    .enum(GROUP_BY_VALUES)
    .default("date")
    .describe("Dimension to group by (one at a time). Drill down by changing this across calls."),
  range: z
    .enum(RANGE_PRESETS)
    .optional()
    .describe("Convenience time window. Ignored if from/to are given. Defaults to today."),
  from: z
    .string()
    .optional()
    .describe(
      "Explicit start bound: YYYY-MM-DD (tenant-local start of day), ISO timestamp with Z/UTC offset, or epoch ms.",
    ),
  to: z
    .string()
    .optional()
    .describe(
      "Explicit end bound: YYYY-MM-DD (tenant-local end of day), ISO timestamp with Z/UTC offset, or epoch ms.",
    ),
  campaign_ids: z.array(z.string().min(1)).optional().describe("Restrict to these campaign IDs."),
  zone_ids: z.array(z.string().min(1)).optional().describe("Restrict to these zone IDs."),
  sub1: z.string().optional().describe("Filter by sub1 value(s), comma-separated for multiple."),
  sub2: z.string().optional().describe("Filter by sub2 value(s)."),
  sub3: z.string().optional().describe("Filter by sub3 value(s)."),
  sub4: z.string().optional().describe("Filter by sub4 value(s)."),
  sub5: z.string().optional().describe("Filter by sub5 value(s)."),
  conversion_type: z
    .string()
    .optional()
    .describe(
      "Filter by conversion type value(s) (e.g. deposit, register), comma-separated for multiple. " +
        'Pass "" to select conversions recorded without a type.',
    ),
  advertiser_email: z
    .string()
    .trim()
    .email()
    .optional()
    .describe(
      "Narrow to one advertiser's campaigns, independent of group_by. Owner/manager: any advertiser. " +
        "advertiser_manager: only one of their own assigned advertisers (else 403). Other roles: 403.",
    ),
  publisher_email: z
    .string()
    .trim()
    .email()
    .optional()
    .describe(
      "Narrow to one publisher's zones, independent of group_by. Owner/manager: any publisher. " +
        "publisher_manager: only one of their own assigned publishers (else 403). Other roles: 403.",
    ),
};

type GetStatsArgs = {
  group_by: GroupBy;
  range?: (typeof RANGE_PRESETS)[number];
  from?: string;
  to?: string;
  campaign_ids?: string[];
  zone_ids?: string[];
  sub1?: string;
  sub2?: string;
  sub3?: string;
  sub4?: string;
  sub5?: string;
  conversion_type?: string;
  advertiser_email?: string;
  publisher_email?: string;
};

export async function getStats(client: AffsetClient, args: GetStatsArgs): Promise<CallToolResult> {
  try {
    const timeZone = await client.getTenantTimezone();
    const { from, to, label } = resolveRange(args.range, args.from, args.to, timeZone);

    const query: Record<string, string | number> = {
      from,
      to,
      group_by: args.group_by,
    };
    if (args.campaign_ids?.length) query.campaign_ids = args.campaign_ids.join(",");
    if (args.zone_ids?.length) query.zone_ids = args.zone_ids.join(",");
    for (const key of SUB_KEYS) {
      const value = args[key];
      if (value !== undefined) query[key] = value;
    }
    if (args.conversion_type !== undefined) query.conversion_type = args.conversion_type;
    if (args.advertiser_email !== undefined) {
      query.advertiser_email = args.advertiser_email.trim();
    }
    if (args.publisher_email !== undefined) {
      query.publisher_email = args.publisher_email.trim();
    }

    const data = await client.get<StatsResponse>("/api/stats", query);
    const table = formatStatsTable(data.stats ?? [], args.group_by, data.sub_labels);
    const heading = groupHeader(args.group_by, data.sub_labels);

    return {
      content: [
        {
          type: "text",
          text: `**Stats — ${label}, by ${heading}**\n\n${table}`,
        },
      ],
    };
  } catch (err) {
    return errorResult(err);
  }
}
