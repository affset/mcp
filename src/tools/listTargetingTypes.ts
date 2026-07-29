import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { fetchTargetingTypes, UNENFORCED_TYPES } from "../lib/targeting.js";
import { errorResult, textResult } from "../lib/toolResult.js";

export const LIST_TARGETING_TYPES_DESCRIPTION =
  "List targeting rule types available in this tenant (id, name, description), " +
  "flagging the seeded types the /serve path does not actually evaluate. " +
  "Use the id (or name) when setting campaign targeting rules. Enforced types: " +
  "geo, device_type, zone_id, os, browser, unique_users.";

export const listTargetingTypesInputSchema = {};

export async function listTargetingTypes(client: AffsetClient): Promise<CallToolResult> {
  try {
    const types = await fetchTargetingTypes(client);

    if (types.length === 0) {
      return textResult("_No targeting rule types found._");
    }

    const lines = [
      `**Targeting rule types** — ${types.length}`,
      "",
      "| Id | Name | Enforced | Description |",
      "|--:|---|---|---|",
    ];
    for (const t of types) {
      const unenforced = UNENFORCED_TYPES[t.name.toLowerCase()];
      lines.push(
        `| ${t.id} | ${mdCell(t.name)} | ${unenforced ? "**no**" : "yes"} | ` +
          `${mdCell(unenforced ?? t.description ?? "—")} |`,
      );
    }
    lines.push("");
    lines.push(
      "_Use these ids with `set_targeting_rule` / `list_targeting_rules`. " +
        "`rule` is usually a comma-separated list (e.g. geo: `BR,MX`; " +
        "unique_users: `visits/hours`)._",
    );
    lines.push(
      "_Values are matched exactly and case-sensitively at serve time (geo from " +
        "`CF-IPCountry`, os/browser from the user agent); `set_targeting_rule` " +
        "normalises what it can and rejects what could never match._",
    );

    return textResult(lines.join("\n"));
  } catch (err) {
    return errorResult(err);
  }
}
