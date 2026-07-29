import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { displayValue, renderDiff, type FieldChange } from "../lib/patch.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import { SUB_KEYS, type SubKey, type SubLabels, type TenantSettingsResponse } from "../types.js";

/** Matches lite-adserver SUB_LABEL_MAX_LENGTH. */
const SUB_LABEL_MAX = 40;

const clearableLabel = z.union([z.string().max(SUB_LABEL_MAX), z.null()]);

export const SET_SUB_LABELS_DESCRIPTION =
  "Set or clear tenant display names for sub1–sub5. Partial update — only provided " +
  'keys change; pass null or "" to clear a label. Max 40 chars each. DRY-RUN by ' +
  "default; pass confirm=true to apply. Affects stats column titles and link helpers.";

export const setSubLabelsInputSchema = {
  sub1: clearableLabel.optional().describe('Display name for sub1, or null/"" to clear.'),
  sub2: clearableLabel.optional().describe('Display name for sub2, or null/"" to clear.'),
  sub3: clearableLabel.optional().describe('Display name for sub3, or null/"" to clear.'),
  sub4: clearableLabel.optional().describe('Display name for sub4, or null/"" to clear.'),
  sub5: clearableLabel.optional().describe('Display name for sub5, or null/"" to clear.'),
  confirm: z.boolean().default(false).describe("false = dry-run preview (default). true = apply."),
};

type SetSubLabelsArgs = {
  sub1?: string | null;
  sub2?: string | null;
  sub3?: string | null;
  sub4?: string | null;
  sub5?: string | null;
  confirm: boolean;
};

export async function setSubLabels(
  client: AffsetClient,
  args: SetSubLabelsArgs,
): Promise<CallToolResult> {
  try {
    const patch = buildPatch(args);
    if ("error" in patch) return textError(patch.error);
    if (Object.keys(patch.updates).length === 0) {
      return textError('Provide at least one of sub1..sub5 to set or clear (null/"" clears).');
    }

    const settings = await client.get<TenantSettingsResponse>("/api/tenant");
    const current = settings.sub_labels ?? {};
    const changes = diffLabels(current, patch.updates);

    if (changes.length === 0) {
      return textResult("Nothing to change — provided sub labels already match current values.");
    }

    if (!args.confirm) {
      return textResult(
        [
          "**Dry run** — would update tenant sub labels.",
          "",
          renderDiff(changes),
          "",
          "Call again with `confirm: true` to apply.",
        ].join("\n"),
      );
    }

    const updated = await client.put<TenantSettingsResponse>("/api/tenant", {
      sub_labels: patch.updates,
    });
    const next = updated.sub_labels ?? {};

    return textResult(
      ["✅ Sub labels updated.", "", renderDiff(changes), "", renderFinal(next)].join("\n"),
    );
  } catch (err) {
    return errorResult(err);
  }
}

function buildPatch(
  args: SetSubLabelsArgs,
): { updates: Partial<Record<SubKey, string | null>> } | { error: string } {
  const updates: Partial<Record<SubKey, string | null>> = {};
  for (const key of SUB_KEYS) {
    if (!(key in args) || args[key] === undefined) continue;
    const raw = args[key];
    if (raw === null) {
      updates[key] = null;
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      updates[key] = null;
      continue;
    }
    if (trimmed.length > SUB_LABEL_MAX) {
      return {
        error: `${key} must be at most ${SUB_LABEL_MAX} characters (got ${trimmed.length}).`,
      };
    }
    updates[key] = trimmed;
  }
  return { updates };
}

function diffLabels(
  current: SubLabels,
  updates: Partial<Record<SubKey, string | null>>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const key of SUB_KEYS) {
    if (!(key in updates)) continue;
    const from = current[key]?.trim() || null;
    const to = updates[key] ?? null;
    if (from === to) continue;
    changes.push({
      field: key,
      from: from ? mdCell(from) : displayValue(null),
      to: to ? mdCell(to) : displayValue(null),
    });
  }
  return changes;
}

function renderFinal(labels: SubLabels): string {
  const lines = ["| Key | Label |", "|---|---|"];
  for (const key of SUB_KEYS) {
    const label = labels[key]?.trim();
    lines.push(`| \`${key}\` | ${label ? mdCell(label) : "_—_"} |`);
  }
  return lines.join("\n");
}
