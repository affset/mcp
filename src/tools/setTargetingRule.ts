import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { displayValue, renderDiff } from "../lib/patch.js";
import {
  fetchTargetingRules,
  fetchTargetingTypes,
  normalizeRuleValue,
  resolveTargetingType,
  syncTargetingRules,
  toSyncPayload,
  UNENFORCED_TYPES,
  type TargetingMethod,
} from "../lib/targeting.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import type { TargetingRule } from "../types.js";

export const SET_TARGETING_RULE_DESCRIPTION =
  "Upsert one targeting rule on a campaign (safe merge — other rules are kept). " +
  "Identify the type by id or name (e.g. geo, zone_id, device_type, os, browser, " +
  "unique_users). If a rule with the same type + method already exists it is updated; " +
  "otherwise a new one is added. `rule` is comma-separated values (geo: BR,MX; " +
  "unique_users: visits/hours). Values are normalised to what /serve matches — an " +
  "unmatched whitelist stops delivery. DRY-RUN by default; pass confirm=true to apply.";

export const setTargetingRuleInputSchema = {
  campaign_id: z.union([z.string().min(1), z.number().int()]).describe("Campaign to edit."),
  type: z
    .union([z.string().min(1), z.number().int()])
    .describe(
      'Targeting type id (number) or name (e.g. "geo", "zone_id", "device_type"). ' +
        "Call list_targeting_types for the catalog.",
    ),
  method: z.enum(["whitelist", "blacklist"]).describe("whitelist or blacklist."),
  rule: z
    .string()
    .min(1)
    .describe(
      'Rule value(s). Usually comma-separated (e.g. "BR,MX", zone UUIDs, "desktop"). ' +
        'unique_users uses "visits/hours".',
    ),
  confirm: z.boolean().default(false).describe("false = dry-run preview (default). true = apply."),
};

type SetTargetingRuleArgs = {
  campaign_id: string | number;
  type: string | number;
  method: TargetingMethod;
  rule: string;
  confirm: boolean;
};

export async function setTargetingRule(
  client: AffsetClient,
  args: SetTargetingRuleArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    const [types, current] = await Promise.all([
      fetchTargetingTypes(client),
      fetchTargetingRules(client, campaignId),
    ]);

    const resolved = resolveTargetingType(types, args.type);
    if ("error" in resolved) return textError(resolved.error);
    const type = resolved.type;

    const unenforced = UNENFORCED_TYPES[type.name.toLowerCase()];
    if (unenforced) {
      return textError(
        `\`${type.name}\` rules are stored by the API but ${unenforced}. ` +
          "Setting one here would read as working targeting while the campaign keeps buying, " +
          "so this tool does not write it.",
      );
    }

    const normalized = normalizeRuleValue(type.name, args.rule);
    if ("error" in normalized) return textError(normalized.error);
    const ruleValue = normalized.value;

    const existing = current.find(
      (r) => r.targeting_rule_type_id === type.id && r.targeting_method === args.method,
    );

    if (existing && existing.rule === ruleValue) {
      return textResult(
        `Nothing to change — campaign \`${campaignId}\` already has ` +
          `${mdCell(type.name)} ${args.method} = \`${mdCell(ruleValue)}\` ` +
          `(rule id \`${existing.id}\`).`,
      );
    }

    const diff = renderDiff([
      {
        field: `${type.name} (${args.method})`,
        from: existing ? existing.rule : displayValue(null),
        to: ruleValue,
      },
    ]);

    const notes = [
      ...normalized.notes,
      ...opposingRuleNote(current, type.id, type.name, args.method),
    ];

    if (!args.confirm) {
      const verb = existing ? "update" : "add";
      return textResult(
        [
          `**Dry run** — would ${verb} targeting on campaign \`${campaignId}\`.`,
          "",
          diff,
          ...(notes.length ? ["", ...notes] : []),
          "",
          `Type: ${mdCell(type.name)} (id ${type.id}). Other rules stay untouched.`,
          "",
          "Call again with `confirm: true` to apply.",
        ].join("\n"),
      );
    }

    const applied = await syncTargetingRules(
      client,
      campaignId,
      upsertRule(current, type.id, args.method, ruleValue),
    );
    const written = applied.find(
      (r) => r.targeting_rule_type_id === type.id && r.targeting_method === args.method,
    );

    return textResult(
      [
        `✅ Targeting ${existing ? "updated" : "added"} on campaign \`${campaignId}\`` +
          (written?.id != null ? ` (rule id \`${written.id}\`)` : "") +
          ".",
        "",
        diff,
        ...(notes.length ? ["", ...notes] : []),
      ].join("\n"),
    );
  } catch (err) {
    if (err instanceof AffsetApiError && err.status === 404) {
      return textError(
        `Campaign \`${String(args.campaign_id).trim()}\` not found in this namespace.`,
      );
    }
    return errorResult(err);
  }
}

/**
 * A whitelist and a blacklist of the same type both apply, and the blacklist
 * wins on any overlap — easy to set by accident when the intent was to replace
 * the other one.
 */
function opposingRuleNote(
  rules: TargetingRule[],
  typeId: number,
  typeName: string,
  method: TargetingMethod,
): string[] {
  const opposite: TargetingMethod = method === "whitelist" ? "blacklist" : "whitelist";
  const other = rules.find(
    (r) => r.targeting_rule_type_id === typeId && r.targeting_method === opposite,
  );
  if (!other) return [];
  return [
    `⚠️ Campaign also has a ${typeName} **${opposite}** (\`${mdCell(other.rule)}\`) — ` +
      `both apply. Use \`remove_targeting_rule\` if it should be replaced instead.`,
  ];
}

/** Echo every existing rule (with id) and upsert the matching type+method slot. */
function upsertRule(
  rules: TargetingRule[],
  typeId: number,
  method: TargetingMethod,
  rule: string,
): TargetingRule[] {
  const next = toSyncPayload(rules);
  const target = next.find(
    (r) => r.targeting_rule_type_id === typeId && r.targeting_method === method,
  );
  if (target) {
    target.rule = rule;
  } else {
    next.push({ targeting_rule_type_id: typeId, targeting_method: method, rule });
  }
  return next;
}
