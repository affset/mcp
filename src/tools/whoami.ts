import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import type { Config } from "../config.js";
import { mdCell } from "../lib/format.js";
import { textResult } from "../lib/toolResult.js";
import type { TenantSettingsResponse } from "../types.js";

export const WHOAMI_DESCRIPTION =
  "Return the tenant this MCP server is bound to: namespace, API base URL, and the " +
  "derived dashboard URL (https://{namespace}.affset.com) — everything you need to " +
  "hand the operator a working deep link, or to pick the right host for a URL you " +
  "were about to guess. Also reports the tenant's company name, timezone and custom " +
  "API domain when the /api/tenant read succeeds. Read-only, no side effects. " +
  "Call this once at the start of a session instead of guessing the namespace from " +
  "the owner's email — one MCP instance = exactly one tenant, and that binding is " +
  "already fixed at startup.";

export const whoamiInputSchema = {};

export async function whoami(client: AffsetClient, config: Config): Promise<CallToolResult> {
  const dashboardUrl = `https://${config.namespace}.affset.com`;

  // Tenant fetch is best-effort: config values are enough on their own.
  let tenant: TenantSettingsResponse | null = null;
  let tenantError: string | null = null;
  try {
    tenant = await client.get<TenantSettingsResponse>("/api/tenant");
  } catch (err) {
    tenantError = err instanceof Error ? err.message : String(err);
  }

  const customApiDomain = tenant?.custom_api_domain?.trim() || "";

  const lines = [
    `**Tenant** \`${mdCell(config.namespace)}\``,
    "",
    "| Field | Value |",
    "|---|---|",
    `| Namespace | \`${mdCell(config.namespace)}\` |`,
    `| Dashboard | ${dashboardUrl} |`,
    `| API base URL | ${mdCell(config.baseUrl)} |`,
    `| Custom API domain | ${customApiDomain ? mdCell(customApiDomain) : "_(not set — API base is the effective public origin)_"} |`,
    `| Company | ${tenant?.company ? mdCell(tenant.company) : "—"} |`,
    `| Timezone | ${tenant?.timezone ? mdCell(tenant.timezone) : "—"} |`,
  ];

  if (tenantError) {
    lines.push("");
    lines.push(
      `⚠️ Could not read /api/tenant: ${mdCell(tenantError)}. Namespace / dashboard / API base above still valid (from local config).`,
    );
  }

  return textResult(lines.join("\n"));
}
