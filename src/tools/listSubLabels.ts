import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { errorResult, textResult } from "../lib/toolResult.js";
import { SUB_KEYS, type TenantSettingsResponse } from "../types.js";

export const LIST_SUB_LABELS_DESCRIPTION =
  "List the tenant's display names for sub1–sub5 (traffic-source breakdown slots). " +
  "Unlabeled slots show as the raw key. Used by get_stats column titles and " +
  "tracking-link / zone-URL query params.";

export const listSubLabelsInputSchema = {};

export async function listSubLabels(client: AffsetClient): Promise<CallToolResult> {
  try {
    const settings = await client.get<TenantSettingsResponse>("/api/tenant");
    const labels = settings.sub_labels ?? {};
    const labeled = SUB_KEYS.filter((k) => (labels[k] ?? "").trim().length > 0);

    const lines = [
      `**Sub labels** — ${labeled.length} of ${SUB_KEYS.length} named`,
      "",
      "| Key | Label |",
      "|---|---|",
    ];
    for (const key of SUB_KEYS) {
      const label = labels[key]?.trim();
      lines.push(`| \`${key}\` | ${label ? mdCell(label) : "_— (raw key)_"} |`);
    }
    lines.push("");
    lines.push("_Set / clear with `set_sub_labels` (null or empty clears a slot)._");

    return textResult(lines.join("\n"));
  } catch (err) {
    return errorResult(err);
  }
}
