import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { errorResult } from "../lib/toolResult.js";
import type { TeamMember } from "../types.js";

export const LIST_TEAM_DESCRIPTION =
  "List team members (user API keys) in the current namespace: email, role, " +
  "manager, created/expiry. Never returns API tokens. Requires owner/manager " +
  "(or a scoped manager role).";

export const listTeamInputSchema = {
  role: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional role filter, e.g. owner, manager, publisher, advertiser, " +
        "publisher_manager, advertiser_manager.",
    ),
  include_expired: z
    .boolean()
    .default(false)
    .describe("Include members whose expires_at is in the past. Default false."),
};

type ListTeamArgs = {
  role?: string;
  include_expired: boolean;
};

export async function listTeam(client: AffsetClient, args: ListTeamArgs): Promise<CallToolResult> {
  try {
    // Team members are user-typed API keys — there is no /api/team endpoint.
    const members = await client.get<TeamMember[]>("/api/api-keys", { type: "user" });
    const list = Array.isArray(members) ? members : [];

    const now = Date.now();
    let filtered = list;
    if (args.role) {
      const role = args.role.trim().toLowerCase();
      filtered = filtered.filter((m) => (m.role ?? "").toLowerCase() === role);
    }
    if (!args.include_expired) {
      filtered = filtered.filter((m) => m.expires_at == null || m.expires_at > now);
    }

    const head =
      `**Team** — ${filtered.length} member(s)` +
      (filtered.length !== list.length ? ` (of ${list.length} total keys)` : "") +
      ".";

    return {
      content: [{ type: "text", text: `${head}\n\n${renderTable(filtered, now)}` }],
    };
  } catch (err) {
    return errorResult(err);
  }
}

function renderTable(members: TeamMember[], now: number): string {
  if (members.length === 0) return "_No team members matched._";
  const lines = ["| Email | Role | Manager | Created | Expires |", "|---|---|---|---|---|"];
  for (const m of members) {
    const expired = m.expires_at != null && m.expires_at <= now;
    lines.push(
      `| ${mdCell(m.email ?? "(no email)")} | ${mdCell(m.role)} | ${mdCell(
        m.manager_email ?? "—",
      )} | ${fmtDay(m.created_at)} | ${
        m.expires_at == null ? "—" : `${fmtDay(m.expires_at)}${expired ? " (expired)" : ""}`
      } |`,
    );
  }
  return lines.join("\n");
}

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
