import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { displayValue, renderDiff, type FieldChange } from "../lib/patch.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import { httpUrlError } from "../lib/urls.js";
import { ZONE_STATUSES, type UpdateZoneResponse, type Zone } from "../types.js";

/** Zod: optional http(s) URL, or null to clear. */
const clearableUrl = z.union([z.string().min(1), z.null()]);

export const UPDATE_ZONE_DESCRIPTION =
  "Update a traffic-source zone (name, status, postback_url, site_url, traffic_back_url). " +
  "Partial update — only provided fields change. Pass null for a URL field to clear it. " +
  "DRY-RUN by default; pass confirm=true to apply.";

export const updateZoneInputSchema = {
  zone_id: z.string().min(1).describe("Zone id to update."),
  name: z.string().min(1).max(200).optional().describe("New display name."),
  status: z.enum(ZONE_STATUSES).optional().describe("active or inactive."),
  postback_url: clearableUrl
    .optional()
    .describe("S2S postback URL, or null to clear. Prefer including {source_click_id}."),
  site_url: clearableUrl.optional().describe("Site URL, or null to clear."),
  traffic_back_url: clearableUrl.optional().describe("Traffic-back URL, or null to clear."),
  confirm: z
    .boolean()
    .default(false)
    .describe("false = dry-run preview (default). true = apply the update."),
};

type UpdateZoneArgs = {
  zone_id: string;
  name?: string;
  status?: (typeof ZONE_STATUSES)[number];
  postback_url?: string | null;
  site_url?: string | null;
  traffic_back_url?: string | null;
  confirm: boolean;
};

export async function updateZone(
  client: AffsetClient,
  args: UpdateZoneArgs,
): Promise<CallToolResult> {
  try {
    const patch = buildPatch(args);
    if ("error" in patch) return textError(patch.error);
    if (Object.keys(patch.body).length === 0) {
      return textError(
        "Provide at least one field to update: name, status, postback_url, site_url, traffic_back_url.",
      );
    }

    let existing: Zone;
    try {
      existing = await client.get<Zone>(`/api/zones/${encodeURIComponent(args.zone_id)}`);
    } catch (err) {
      if (err instanceof AffsetApiError && err.status === 404) {
        return textError(`Zone \`${args.zone_id}\` not found in this namespace.`);
      }
      throw err;
    }

    const changes = diffZone(existing, patch.body);
    if (changes.length === 0) {
      return textResult(
        `Nothing to change on zone \`${existing.id}\` (${existing.name}) — ` +
          "provided fields already match current values.",
      );
    }

    const warnings: string[] = [];
    if (patch.body.status === "inactive" && existing.status !== "inactive") {
      warnings.push(
        "⚠️ Setting status to **inactive** makes both /serve and direct tracking links " +
          "for this zone return 404 until it is reactivated.",
      );
    }
    if (
      "postback_url" in patch.body &&
      (patch.body.postback_url === null || patch.body.postback_url === "")
    ) {
      warnings.push(
        "⚠️ Clearing postback_url means the traffic source will stop receiving conversion postbacks.",
      );
    } else if (
      typeof patch.body.postback_url === "string" &&
      !patch.body.postback_url.includes("{source_click_id}")
    ) {
      warnings.push(
        "⚠️ postback_url has no `{source_click_id}` — the source may not attribute conversions.",
      );
    }

    if (!args.confirm) {
      return textResult(
        [
          `**Dry run** — would update zone \`${existing.id}\` (${existing.name}).`,
          "",
          renderDiff(changes),
          ...(warnings.length ? ["", ...warnings] : []),
          "",
          "Call again with `confirm: true` to apply.",
        ].join("\n"),
      );
    }

    const updated = await client.put<UpdateZoneResponse>(
      `/api/zones/${encodeURIComponent(args.zone_id)}`,
      patch.body,
    );

    return textResult(
      [
        `✅ Zone \`${updated.id}\` updated.`,
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
  args: UpdateZoneArgs,
): { body: Record<string, string | null> } | { error: string } {
  const body: Record<string, string | null> = {};
  if (args.name !== undefined) {
    const name = args.name.trim();
    if (!name) return { error: "name must be a non-empty string." };
    body.name = name;
  }
  if (args.status !== undefined) body.status = args.status;

  for (const key of ["postback_url", "site_url", "traffic_back_url"] as const) {
    if (args[key] === undefined) continue;
    if (args[key] === null) {
      body[key] = null;
      continue;
    }
    const err = httpUrlError(args[key], key);
    if (err) return { error: err };
    body[key] = args[key]!;
  }

  return { body };
}

function diffZone(existing: Zone, body: Record<string, string | null>): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, to] of Object.entries(body)) {
    const from = (existing as unknown as Record<string, unknown>)[field];
    if (String(from ?? "") === String(to ?? "")) continue;
    changes.push({ field, from: displayValue(from ?? null), to: displayValue(to) });
  }
  return changes;
}
