import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import {
  fetchTargetingRules,
  fetchTargetingTypes,
  resolveTargetingType,
  syncTargetingRules,
  toSyncPayload,
  type TargetingMethod,
} from "../lib/targeting.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import type { TargetingRule, TargetingRuleType } from "../types.js";

export const REMOVE_TARGETING_RULE_DESCRIPTION =
  "Remove one targeting rule from a campaign (safe merge — other rules are kept). " +
  "Identify by rule_id, or by type + method. DRY-RUN by default; pass confirm=true to apply.";

export const removeTargetingRuleInputSchema = {
  campaign_id: z.union([z.string().min(1), z.number().int()]).describe("Campaign to edit."),
  rule_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Existing rule id (from list_targeting_rules). Prefer this when known."),
  type: z
    .union([z.string().min(1), z.number().int()])
    .optional()
    .describe("Targeting type id or name. Required with method when rule_id is omitted."),
  method: z
    .enum(["whitelist", "blacklist"])
    .optional()
    .describe("whitelist or blacklist. Required with type when rule_id is omitted."),
  confirm: z.boolean().default(false).describe("false = dry-run preview (default). true = apply."),
};

type RemoveTargetingRuleArgs = {
  campaign_id: string | number;
  rule_id?: number;
  type?: string | number;
  method?: TargetingMethod;
  confirm: boolean;
};

export async function removeTargetingRule(
  client: AffsetClient,
  args: RemoveTargetingRuleArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    if (args.rule_id == null && (args.type == null || args.method == null)) {
      return textError("Provide rule_id, or both type and method, to identify the rule to remove.");
    }

    const [types, current] = await Promise.all([
      fetchTargetingTypes(client),
      fetchTargetingRules(client, campaignId),
    ]);

    const target = findTarget(types, current, args);
    if ("error" in target) return textError(target.error);
    const rule = target.rule;

    const typeName =
      types.find((t) => t.id === rule.targeting_rule_type_id)?.name ??
      String(rule.targeting_rule_type_id);

    if (!args.confirm) {
      return textResult(
        [
          `**Dry run** — would remove targeting rule on campaign \`${campaignId}\`.`,
          "",
          "| Field | Value |",
          "|---|---|",
          `| Id | \`${rule.id ?? "—"}\` |`,
          `| Type | ${mdCell(typeName)} (${rule.targeting_rule_type_id}) |`,
          `| Method | ${mdCell(rule.targeting_method)} |`,
          `| Rule | ${mdCell(rule.rule)} |`,
          "",
          removalNote(current, rule, typeName),
          "",
          "Other rules stay untouched. Call again with `confirm: true` to apply.",
        ].join("\n"),
      );
    }

    // Identity, not id: a rule row the API returned without an id must not take
    // every other id-less row with it.
    await syncTargetingRules(client, campaignId, toSyncPayload(current.filter((r) => r !== rule)));

    return textResult(
      `✅ Removed ${mdCell(typeName)} ${rule.targeting_method} rule ` +
        `\`${mdCell(rule.rule)}\` (id \`${rule.id ?? "—"}\`) from campaign \`${campaignId}\`.`,
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

/** What the campaign is left targeting once this rule is gone. */
function removalNote(rules: TargetingRule[], rule: TargetingRule, typeName: string): string {
  const remaining = rules.filter(
    (r) => r !== rule && r.targeting_rule_type_id === rule.targeting_rule_type_id,
  );
  if (remaining.length > 0) {
    return `${typeName} stays gated by ${remaining.length} other rule(s) of the same type.`;
  }
  return rules.length === 1
    ? "⚠️ This is the campaign's last rule — it becomes unrestricted on `/serve`."
    : `${typeName} becomes unrestricted; other rule types still apply.`;
}

function findTarget(
  types: TargetingRuleType[],
  rules: TargetingRule[],
  args: RemoveTargetingRuleArgs,
): { rule: TargetingRule } | { error: string } {
  if (args.rule_id != null) {
    const match = rules.find((r) => r.id === args.rule_id);
    if (!match) {
      return { error: `No targeting rule with id \`${args.rule_id}\` on this campaign.` };
    }
    return { rule: match };
  }

  const resolved = resolveTargetingType(types, args.type!);
  if ("error" in resolved) return resolved;

  const matches = rules.filter(
    (r) => r.targeting_rule_type_id === resolved.type.id && r.targeting_method === args.method,
  );
  if (matches.length === 0) {
    return {
      error: `No ${args.method} rule of type ${resolved.type.name} on this campaign.`,
    };
  }
  if (matches.length > 1) {
    const ids = matches.map((r) => `\`${r.id}\``).join(", ");
    return {
      error:
        `${matches.length} ${resolved.type.name} ${args.method} rules on this campaign ` +
        `(${ids}) — pass rule_id to say which one to remove.`,
    };
  }
  return { rule: matches[0] };
}
