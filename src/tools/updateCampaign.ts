import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { displayValue, renderDiff, type FieldChange } from "../lib/patch.js";
import { money } from "../lib/format.js";
import { parseCampaignDateBound } from "../lib/time.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import { httpUrlError } from "../lib/urls.js";
import {
  CAMPAIGN_STATUSES,
  PACING_VALUES,
  PAYMENT_MODELS,
  type Campaign,
  type UpdateCampaignResponse,
} from "../types.js";

export const UPDATE_CAMPAIGN_DESCRIPTION =
  "Update a campaign (partial): name, offer URL (redirect_url), status, rate, " +
  "payment_model, start/end dates, daily/total budget, pacing. DRY-RUN by default; " +
  "pass confirm=true to apply. For run/pause prefer set_campaign_status. Activating " +
  "a paused campaign can hit the plan's active-campaign limit (402). Targeting rules " +
  "and payout rules are separate tools.";

export const updateCampaignInputSchema = {
  campaign_id: z.union([z.string().min(1), z.number().int()]).describe("Campaign id to update."),
  name: z.string().min(1).max(200).optional().describe("New campaign name."),
  redirect_url: z
    .string()
    .min(1)
    .optional()
    .describe("Offer / lander URL (redirect target). http(s) required."),
  status: z
    .enum(CAMPAIGN_STATUSES)
    .optional()
    .describe("active | paused | archived. active enters /serve rotation (plan limit)."),
  payment_model: z.enum(PAYMENT_MODELS).optional().describe("cpa or cpm."),
  rate: z
    .number()
    .min(0)
    .optional()
    .describe("Internal advertiser rate (usually 0 for media-buying)."),
  start_date: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .describe(
      "Start bound: YYYY-MM-DD (tenant-local start of day), ISO timestamp with Z/UTC offset, epoch ms, or null to clear.",
    ),
  end_date: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .describe(
      "End bound: YYYY-MM-DD (tenant-local end of day), ISO timestamp with Z/UTC offset, epoch ms, or null to clear.",
    ),
  daily_budget: z
    .union([z.number().min(0), z.null()])
    .optional()
    .describe("Daily budget cap in USD, or null to clear."),
  total_budget: z
    .union([z.number().min(0), z.null()])
    .optional()
    .describe("Total budget cap in USD, or null to clear."),
  pacing: z.enum(PACING_VALUES).optional().describe("Budget pacing: asap or even."),
  confirm: z
    .boolean()
    .default(false)
    .describe("false = dry-run preview (default). true = apply the update."),
};

type UpdateCampaignArgs = {
  campaign_id: string | number;
  name?: string;
  redirect_url?: string;
  status?: (typeof CAMPAIGN_STATUSES)[number];
  payment_model?: (typeof PAYMENT_MODELS)[number];
  rate?: number;
  start_date?: string | number | null;
  end_date?: string | number | null;
  daily_budget?: number | null;
  total_budget?: number | null;
  pacing?: (typeof PACING_VALUES)[number];
  confirm: boolean;
};

export async function updateCampaign(
  client: AffsetClient,
  args: UpdateCampaignArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    const needsTenantTimezone = [args.start_date, args.end_date].some(
      (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()),
    );
    const timeZone = needsTenantTimezone ? await client.getRequiredTenantTimezone() : "UTC";
    const patch = buildPatch(args, timeZone);
    if ("error" in patch) return textError(patch.error);
    if (Object.keys(patch.body).length === 0) {
      return textError(
        "Provide at least one field to update: name, redirect_url, status, payment_model, " +
          "rate, start_date, end_date, daily_budget, total_budget, pacing.",
      );
    }

    let existing: Campaign;
    try {
      existing = await client.get<Campaign>(`/api/campaigns/${encodeURIComponent(campaignId)}`);
    } catch (err) {
      if (err instanceof AffsetApiError && err.status === 404) {
        return textError(`Campaign \`${campaignId}\` not found in this namespace.`);
      }
      throw err;
    }

    const dateError = validateDateOrder(existing, patch.body);
    if (dateError) return textError(dateError);

    const changes = diffCampaign(existing, patch.body);
    if (changes.length === 0) {
      return textResult(
        `Nothing to change on campaign \`${existing.id}\` (${existing.name}) — ` +
          "provided fields already match current values.",
      );
    }

    const warnings = buildWarnings(existing, patch.body);

    if (!args.confirm) {
      return textResult(
        [
          `**Dry run** — would update campaign \`${existing.id}\` (${existing.name}).`,
          "",
          renderDiff(changes),
          ...(warnings.length ? ["", ...warnings] : []),
          "",
          "Call again with `confirm: true` to apply.",
        ].join("\n"),
      );
    }

    const updated = await client.put<UpdateCampaignResponse>(
      `/api/campaigns/${encodeURIComponent(campaignId)}`,
      patch.body,
    );

    return textResult(
      [
        `✅ Campaign \`${updated.id}\` updated.`,
        "",
        renderDiff(changes),
        ...(warnings.length ? ["", ...warnings] : []),
      ].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}

function buildPatch(
  args: UpdateCampaignArgs,
  timeZone: string,
): { body: Record<string, string | number | null> } | { error: string } {
  const body: Record<string, string | number | null> = {};

  if (args.name !== undefined) {
    const name = args.name.trim();
    if (!name) return { error: "name must be a non-empty string." };
    body.name = name;
  }
  if (args.redirect_url !== undefined) {
    const err = httpUrlError(args.redirect_url, "redirect_url");
    if (err) return { error: err };
    body.redirect_url = args.redirect_url;
  }
  if (args.status !== undefined) body.status = args.status;
  if (args.payment_model !== undefined) body.payment_model = args.payment_model;
  if (args.rate !== undefined) body.rate = args.rate;
  if (args.pacing !== undefined) body.pacing = args.pacing;
  if (args.daily_budget !== undefined) body.daily_budget = args.daily_budget;
  if (args.total_budget !== undefined) body.total_budget = args.total_budget;

  if (args.start_date !== undefined) {
    const parsed = parseDateBound(args.start_date, "start_date", timeZone);
    if ("error" in parsed) return parsed;
    body.start_date = parsed.value;
  }
  if (args.end_date !== undefined) {
    const parsed = parseDateBound(args.end_date, "end_date", timeZone);
    if ("error" in parsed) return parsed;
    body.end_date = parsed.value;
  }

  return { body };
}

/**
 * YYYY-MM-DD → tenant-local start-of-day for start_date, end-of-day for end_date
 * (so "end 2026-07-25" keeps the campaign live through that calendar day).
 */
function parseDateBound(
  value: string | number | null,
  label: "start_date" | "end_date",
  timeZone: string,
): { value: number | null } | { error: string } {
  try {
    return {
      value: parseCampaignDateBound(value, label === "start_date" ? "start" : "end", timeZone),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Invalid ${label}: ${message}` };
  }
}

/** Reject inverted ranges against the patch and/or the existing campaign. */
function validateDateOrder(
  existing: Campaign,
  body: Record<string, string | number | null>,
): string | undefined {
  const start = body.start_date !== undefined ? body.start_date : (existing.start_date ?? null);
  const end = body.end_date !== undefined ? body.end_date : (existing.end_date ?? null);
  if (typeof start === "number" && typeof end === "number" && end <= start) {
    return "end_date must be after start_date.";
  }
  return undefined;
}

function diffCampaign(
  existing: Campaign,
  body: Record<string, string | number | null>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, to] of Object.entries(body)) {
    const from = (existing as unknown as Record<string, unknown>)[field];
    if (normalizeCompare(from) === normalizeCompare(to)) continue;
    changes.push({
      field,
      from: formatField(field, from),
      to: formatField(field, to),
    });
  }
  return changes;
}

function normalizeCompare(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function formatField(field: string, value: unknown): string {
  if (value === undefined || value === null) return displayValue(value ?? null);
  if (
    (field === "daily_budget" || field === "total_budget" || field === "rate") &&
    typeof value === "number"
  ) {
    return field === "rate" ? String(value) : money(value);
  }
  if ((field === "start_date" || field === "end_date") && typeof value === "number") {
    return new Date(value).toISOString();
  }
  return displayValue(value);
}

function buildWarnings(existing: Campaign, body: Record<string, string | number | null>): string[] {
  const warnings: string[] = [];
  if (body.status === "active" && existing.status !== "active") {
    warnings.push(
      "⚠️ Activating enables direct tracking links, enters `/serve` rotation, and counts against the plan's " +
        "**active campaigns** limit (API returns 402 if exceeded).",
    );
  }
  if (body.status === "archived" && existing.status !== "archived") {
    warnings.push(
      "⚠️ Archiving disables direct tracking links and removes the campaign from /serve.",
    );
  }
  if (body.redirect_url !== undefined && body.redirect_url !== existing.redirect_url) {
    warnings.push("⚠️ Changing redirect_url changes where clicks land immediately.");
  }
  return warnings;
}
