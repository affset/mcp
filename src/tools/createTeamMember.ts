import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AffsetClient } from "../client.js";
import { mdCell } from "../lib/format.js";
import { errorResult, textError, textResult } from "../lib/toolResult.js";

/** Matches lite-adserver's TENANT_ROLES. */
const TENANT_ROLES = [
  "owner",
  "manager",
  "advertiser_manager",
  "publisher_manager",
  "advertiser",
  "publisher",
] as const;
type TenantRole = (typeof TENANT_ROLES)[number];

/** manager_email is only meaningful for these two roles. */
const MANAGED_ROLES: TenantRole[] = ["advertiser", "publisher"];

const PERMISSION_VALUES = ["read", "write"] as const;
const MAX_EPOCH_MS = 8_640_000_000_000_000;
/** affset tokens are `sk_live_` + 64 hex (~72 chars). Bound what we echo into model context. */
const MAX_TOKEN_LENGTH = 200;

export const CREATE_TEAM_MEMBER_DESCRIPTION =
  "Invite a team member: create a user API key with an email in the current namespace — " +
  'the same operation as the dashboard\'s "Add Team Member". Requires owner/manager, or a ' +
  "scoped manager role (publisher_manager / advertiser_manager), which can only create its " +
  "own managed role (publisher / advertiser respectively) assigned to itself — the API " +
  "enforces this, not this tool, so a scoped manager's role/manager_email args may be " +
  "overridden. Returns the new member's plaintext API key ONCE, in the confirmed response " +
  "— it is not shown again by list_team, which deliberately never echoes tokens, so copy " +
  "it now and send it to them over a private channel. Does not send an invite email; the " +
  "API key is the credential, handed over out of band. " +
  "DRY-RUN by default; pass confirm=true to apply.";

export const createTeamMemberInputSchema = {
  email: z
    .string()
    .trim()
    .email()
    .describe("New team member's email — their login / API identity."),
  role: z
    .enum(TENANT_ROLES)
    .describe(
      "owner | manager | advertiser_manager | publisher_manager | advertiser | publisher. " +
        "What your own API key's role is allowed to create is enforced by the API.",
    ),
  manager_email: z
    .string()
    .trim()
    .email()
    .optional()
    .describe(
      "Assign to a publisher_manager / advertiser_manager. Only valid with role=publisher or " +
        "role=advertiser. A scoped manager key ignores this and assigns itself instead.",
    ),
  permissions: z
    .array(z.enum(PERMISSION_VALUES))
    .nonempty()
    .optional()
    .describe(
      'Defaults to ["read","write"] (matches the dashboard\'s default). "read" is always included.',
    ),
  expires_at: z
    .number()
    .int()
    .positive()
    .max(MAX_EPOCH_MS)
    .optional()
    .describe("Optional future expiry as epoch milliseconds. Omit for a key that never expires."),
  confirm: z
    .boolean()
    .default(false)
    .describe("false = dry-run preview (default). true = create the member and issue the key."),
};

type CreateTeamMemberArgs = {
  email: string;
  role: TenantRole;
  manager_email?: string;
  permissions?: (typeof PERMISSION_VALUES)[number][];
  expires_at?: number;
  confirm: boolean;
};

export async function createTeamMember(
  client: AffsetClient,
  args: CreateTeamMemberArgs,
): Promise<CallToolResult> {
  try {
    const email = args.email.trim();
    if (!email) return textError("email is required.");

    const managerEmail = args.manager_email?.trim();
    if (args.manager_email !== undefined && !managerEmail) {
      return textError("manager_email must not be blank when provided.");
    }
    if (managerEmail !== undefined && !MANAGED_ROLES.includes(args.role)) {
      return textError("manager_email is only allowed with role=publisher or role=advertiser.");
    }

    const expiryError = validateExpiry(args.expires_at);
    if (expiryError) return textError(expiryError);

    const permissions = normalizePermissions(args.permissions);
    const expiresNote = args.expires_at !== undefined ? fmtDay(args.expires_at) : "never";

    const summaryTable = [
      "| Field | Value |",
      "|---|---|",
      `| Email | ${mdCell(email)} |`,
      `| Role | ${mdCell(args.role)} |`,
      `| Manager | ${mdCell(managerEmail ?? "—")} |`,
      `| Permissions | ${permissions.join(", ")} |`,
      `| Expires | ${mdCell(expiresNote)} |`,
    ].join("\n");

    if (!args.confirm) {
      return textResult(
        [
          "**Dry run** — would create a team member with:",
          "",
          summaryTable,
          "",
          "Call again with `confirm: true` to create it and issue the API key. A scoped " +
            "manager key (publisher_manager / advertiser_manager) can only create its own " +
            "managed role, assigned to itself — the fields above may be overridden by the API.",
        ].join("\n"),
      );
    }

    const body: Record<string, unknown> = { email, role: args.role, permissions };
    if (managerEmail !== undefined) body.manager_email = managerEmail;
    if (args.expires_at !== undefined) body.expires_at = args.expires_at;

    // Treat the response as untrusted at runtime. Most importantly, do not let a
    // malformed optional field throw after the non-idempotent POST succeeded: that
    // would report an error and make a duplicate retry look appropriate.
    const rawCreated = await client.post<unknown>("/api/api-keys?type=user", body);
    const created = isRecord(rawCreated) ? rawCreated : {};
    const createdEmail = stringField(created.email, email);
    const createdRole = stringField(created.role, args.role);
    const createdManager = nullableStringField(created.manager_email, managerEmail ?? "—");
    const createdPermissions = permissionFields(created.permissions, permissions);
    const createdExpiry = expiryField(created.expires_at, expiresNote);
    const token = extractToken(created.token);

    const result = [
      `✅ Team member **${mdCell(createdEmail)}** created.`,
      "",
      "| Field | Value |",
      "|---|---|",
      `| Email | ${mdCell(createdEmail)} |`,
      `| Role | ${mdCell(createdRole)} |`,
      `| Manager | ${mdCell(createdManager)} |`,
      `| Permissions | ${createdPermissions.map(mdCell).join(", ")} |`,
      `| Expires | ${mdCell(createdExpiry)} |`,
      "",
    ];

    if (token) {
      result.push(
        "**API key** (shown once here — treat it like a password, send it over a private channel):",
        secretBlock(token),
        "`list_team` will show this person from now on, but never their token. If it leaks, " +
          "revoke access from the dashboard's Team page.",
      );
    } else {
      result.push(
        "⚠️ The member was created, but the API response did not include a usable API key. " +
          "Do not retry this create call: that could create a duplicate. Retrieve or rotate " +
          "the key from the dashboard's Team page.",
      );
    }

    return textResult(result.join("\n"));
  } catch (err) {
    return errorResult(err);
  }
}

function normalizePermissions(raw: (typeof PERMISSION_VALUES)[number][] | undefined): string[] {
  const set = new Set(raw && raw.length > 0 ? raw : PERMISSION_VALUES);
  set.add("read");
  return PERMISSION_VALUES.filter((permission) => set.has(permission));
}

function fmtDay(ms: number): string {
  return new Date(ms).toISOString().split("T", 1)[0];
}

function validateExpiry(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  if (!Number.isInteger(ms) || ms <= 0 || ms > MAX_EPOCH_MS) {
    return "expires_at must be a valid positive epoch-millisecond timestamp.";
  }
  if (ms <= Date.now()) return "expires_at must be in the future.";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function nullableStringField(value: unknown, fallback: string): string {
  if (value === null) return "—";
  return stringField(value, fallback);
}

function permissionFields(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const permissions = value.filter(
    (permission): permission is string =>
      typeof permission === "string" && permission.trim() !== "",
  );
  return permissions.length > 0 ? permissions : fallback;
}

function expiryField(value: unknown, fallback: string): string {
  if (value === null) return "never";
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  try {
    return fmtDay(value);
  } catch {
    return fallback;
  }
}

/** Use a fence longer than any backtick run in the secret, so it cannot close the block. */
function secretBlock(secret: string): string {
  const longestRun = Math.max(0, ...(secret.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${secret}\n${fence}`;
}
