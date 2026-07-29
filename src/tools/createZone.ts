import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import { httpUrlError } from "../lib/urls.js";
import type { CreateZoneResponse, Zone } from "../types.js";

export const CREATE_ZONE_DESCRIPTION =
  "Create a traffic-source zone in the current namespace. Requires a name; optional " +
  "postback_url (where conversions are reported back — include {source_click_id}), " +
  "site_url, traffic_back_url, and user_email (publisher owner). Status is always " +
  "active on create. Counts against the plan's zone limit (402 if exceeded). " +
  "DRY-RUN by default; pass confirm=true to apply.";

export const createZoneInputSchema = {
  name: z.string().min(1).max(200).describe("Zone display name (traffic source / placement)."),
  postback_url: z
    .string()
    .min(1)
    .optional()
    .describe(
      "S2S postback URL for the traffic source. Should include {source_click_id} so " +
        "conversions can be attributed back to the source click.",
    ),
  site_url: z.string().min(1).optional().describe("Optional site / inventory URL."),
  traffic_back_url: z
    .string()
    .min(1)
    .optional()
    .describe("Optional traffic-back / fallback URL when no campaign can serve."),
  user_email: z
    .string()
    .email()
    .optional()
    .describe("Optional publisher email to own this zone (owner/manager only)."),
  confirm: z
    .boolean()
    .default(false)
    .describe("false = dry-run preview (default). true = create the zone."),
};

type CreateZoneArgs = {
  name: string;
  postback_url?: string;
  site_url?: string;
  traffic_back_url?: string;
  user_email?: string;
  confirm: boolean;
};

export async function createZone(
  client: AffsetClient,
  args: CreateZoneArgs,
): Promise<CallToolResult> {
  try {
    const name = args.name.trim();
    if (!name) return textError("name is required.");

    for (const [label, value] of [
      ["postback_url", args.postback_url],
      ["site_url", args.site_url],
      ["traffic_back_url", args.traffic_back_url],
    ] as const) {
      if (value !== undefined) {
        const err = httpUrlError(value, label);
        if (err) return textError(err);
      }
    }

    const postback = args.postback_url;
    const postbackNote = !postback
      ? "⚠️ none — set postback_url (with {source_click_id}) or the source will not see conversions"
      : !postback.includes("{source_click_id}")
        ? `${mdCell(postback)} — ⚠️ missing \`{source_click_id}\``
        : mdCell(postback);

    const summaryTable = [
      "| Field | Value |",
      "|---|---|",
      `| Name | ${mdCell(name)} |`,
      `| Status | active (forced on create) |`,
      `| Postback | ${postbackNote} |`,
      `| Site | ${mdCell(args.site_url ?? "—")} |`,
      `| Traffic back | ${mdCell(args.traffic_back_url ?? "—")} |`,
      `| Publisher | ${mdCell(args.user_email ?? "—")} |`,
    ].join("\n");

    if (!args.confirm) {
      return textResult(
        [
          "**Dry run** — would create a zone with:",
          "",
          summaryTable,
          "",
          "Call again with `confirm: true` to create it. Counts against the plan's zone limit.",
        ].join("\n"),
      );
    }

    const body: Record<string, string> = { name };
    if (args.postback_url !== undefined) body.postback_url = args.postback_url;
    if (args.site_url !== undefined) body.site_url = args.site_url;
    if (args.traffic_back_url !== undefined) body.traffic_back_url = args.traffic_back_url;
    if (args.user_email !== undefined) body.user_email = args.user_email;

    const created = await client.post<CreateZoneResponse>("/api/zones", body);

    // Create response is sparse — fetch full row for the echo.
    let zone: Zone | null = null;
    try {
      zone = await client.get<Zone>(`/api/zones/${encodeURIComponent(created.id)}`);
    } catch {
      // Non-fatal; fall back to the create payload.
    }

    const createdPostback = zone?.postback_url ?? args.postback_url;
    const createdPostbackNote = !createdPostback
      ? "⚠️ none — set postback_url (with {source_click_id}) or the source will not see conversions"
      : !createdPostback.includes("{source_click_id}")
        ? `${mdCell(createdPostback)} — ⚠️ missing \`{source_click_id}\``
        : mdCell(createdPostback);

    return textResult(
      [
        `✅ Zone **${mdCell(zone?.name ?? name)}** created (id \`${created.id}\`).`,
        "",
        "| Field | Value |",
        "|---|---|",
        `| Status | ${zone?.status ?? created.status} (forced active on create) |`,
        `| Postback | ${createdPostbackNote} |`,
        `| Site | ${mdCell(zone?.site_url ?? args.site_url ?? "—")} |`,
        `| Traffic back | ${mdCell(zone?.traffic_back_url ?? args.traffic_back_url ?? "—")} |`,
        `| Publisher | ${mdCell(zone?.user_email ?? args.user_email ?? "—")} |`,
        "",
        "Use this zone id with `create_campaign` (or pass it as zone_id) for tracking links.",
      ].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}
