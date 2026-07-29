import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AffsetApiError, type AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { fetchTargetingRules, fetchTargetingTypes, UNENFORCED_TYPES } from "../lib/targeting.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";
import type { TargetingRule, TargetingRuleType } from "../types.js";

export const LIST_TARGETING_RULES_DESCRIPTION =
  "List a campaign's targeting rules (type, method whitelist/blacklist, rule values). " +
  "Rules gate /serve rotation; the direct tracking link does not enforce them. " +
  "Call `list_targeting_types` for type ids/names.";

export const listTargetingRulesInputSchema = {
  campaign_id: z
    .union([z.string().min(1), z.number().int()])
    .describe("Campaign whose targeting rules to list."),
};

type ListTargetingRulesArgs = {
  campaign_id: string | number;
};

export async function listTargetingRules(
  client: AffsetClient,
  args: ListTargetingRulesArgs,
): Promise<CallToolResult> {
  try {
    const campaignId = String(args.campaign_id).trim();
    if (!campaignId) return textError("campaign_id is required.");

    const [rules, types] = await Promise.all([
      fetchTargetingRules(client, campaignId),
      // Names are a nicety; a rule list is still useful with bare type ids.
      fetchTargetingTypes(client).catch((): TargetingRuleType[] => []),
    ]);
    const typeById = new Map(types.map((t) => [t.id, t]));

    const dead = rules.filter((r) => {
      const name = typeById.get(r.targeting_rule_type_id)?.name.toLowerCase();
      return name !== undefined && UNENFORCED_TYPES[name] !== undefined;
    });

    return textResult(
      [
        `**Targeting rules** — campaign \`${campaignId}\` — ${rules.length} rule(s)`,
        "",
        renderRules(rules, typeById),
        ...(dead.length ? ["", ...deadRuleWarnings(dead, typeById)] : []),
        "",
        "_Enforced on `/serve` rotation only — not on direct tracking links._",
        "_Manage with `set_targeting_rule` / `remove_targeting_rule`._",
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

function renderRules(rules: TargetingRule[], typeById: Map<number, TargetingRuleType>): string {
  if (rules.length === 0) {
    return "_No targeting rules — campaign is unrestricted on /serve._";
  }
  const lines = ["| Id | Type | Method | Rule |", "|---|---|---|---|"];
  for (const r of rules) {
    const t = typeById.get(r.targeting_rule_type_id);
    const typeLabel = t
      ? `${mdCell(t.name)} (${r.targeting_rule_type_id})`
      : String(r.targeting_rule_type_id);
    const inert = t && UNENFORCED_TYPES[t.name.toLowerCase()] ? " ⚠️" : "";
    lines.push(
      `| ${r.id ?? "—"} | ${typeLabel}${inert} | ${mdCell(r.targeting_method)} | ${mdCell(r.rule)} |`,
    );
  }
  return lines.join("\n");
}

/**
 * Rules of a seeded-but-unevaluated type read as working targeting. Saying so on
 * every listing is the only place an operator would find out.
 */
function deadRuleWarnings(
  dead: TargetingRule[],
  typeById: Map<number, TargetingRuleType>,
): string[] {
  const names = [...new Set(dead.map((r) => typeById.get(r.targeting_rule_type_id)!.name))];
  return names.map(
    (name) => `⚠️ \`${name}\` — ${UNENFORCED_TYPES[name.toLowerCase()]}. This rule has no effect.`,
  );
}
