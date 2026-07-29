/**
 * Targeting helpers shared by the targeting tools.
 *
 * The serve path matches `targeting_rules.rule` with an exact, case-sensitive
 * string compare against what Cloudflare and Bowser produce for the request
 * (lite-adserver `campaignSelectionService`): `CF-IPCountry` is upper-case
 * ISO-3166 alpha-2, OS/browser names are Bowser's own spellings, device type is
 * one of three lower-case words. A rule an operator reads as obviously correct —
 * `geo: br,mx`, `os: android` — therefore matches nothing, and a whitelist that
 * matches nothing takes the campaign out of rotation without an error anywhere.
 * Everything written through these tools is normalised to the serve path's
 * spelling first, and anything unrecognised comes back as a warning rather than
 * being silently stored.
 */

import type { AffsetClient } from "../client.js";
import type {
  TargetingRule,
  TargetingRulesResponse,
  TargetingRuleType,
  TargetingRuleTypesResponse,
} from "../types.js";

export type TargetingMethod = "whitelist" | "blacklist";

/**
 * Seeded types the `/serve` path never evaluates. They accept writes through the
 * API and then do nothing, so an hours rule reads as a working dayparting setup
 * while the campaign keeps buying around the clock.
 */
export const UNENFORCED_TYPES: Record<string, string> = {
  capping: 'not evaluated on /serve — use `unique_users` ("visits/hours") for frequency capping',
  weekdays: "not evaluated on /serve — no dayparting; pause the campaign instead",
  hours: "not evaluated on /serve — no dayparting; pause the campaign instead",
};

/** Device types `detectDeviceType` can return; anything else never matches. */
const DEVICE_TYPES = ["desktop", "mobile", "tablet"] as const;

/**
 * Bowser OS names worth aliasing, keyed by their lower-case form.
 *
 * The `windows_*` and `chrome_os` keys are the ids the dashboard's selectors
 * wrote into rules before they stored serve-path names; campaigns saved then
 * still carry them, and the ad server resolves them the same way
 * (`normalizeOsName` in lite-adserver/src/utils/deviceDetection.ts).
 */
const OS_ALIASES: Record<string, string> = {
  android: "Android",
  ios: "iOS",
  iphone: "iOS",
  ipad: "iOS",
  windows: "Windows",
  windows_7: "Windows",
  windows_10: "Windows",
  windows_11: "Windows",
  "windows 7": "Windows",
  "windows 10": "Windows",
  "windows 11": "Windows",
  "windows phone": "Windows Phone",
  macos: "macOS",
  "mac os": "macOS",
  osx: "macOS",
  "mac os x": "macOS",
  linux: "Linux",
  "chrome os": "Chrome OS",
  chrome_os: "Chrome OS",
  chromeos: "Chrome OS",
};

/** Bowser browser names worth aliasing, keyed by their lower-case form. */
const BROWSER_ALIASES: Record<string, string> = {
  chrome: "Chrome",
  chromium: "Chromium",
  firefox: "Firefox",
  safari: "Safari",
  opera: "Opera",
  edge: "Microsoft Edge",
  "microsoft edge": "Microsoft Edge",
  ie: "Internet Explorer",
  "internet explorer": "Internet Explorer",
  samsung: "Samsung Internet for Android",
  samsung_internet: "Samsung Internet for Android",
  "samsung internet": "Samsung Internet for Android",
  "samsung internet for android": "Samsung Internet for Android",
  "android browser": "Android Browser",
  uc: "UC Browser",
  "uc browser": "UC Browser",
  vivaldi: "Vivaldi",
  yandex: "Yandex Browser",
  "yandex browser": "Yandex Browser",
};

/** Mirrors lite-adserver `isValidZoneId` (UUID v4 or legacy `zone-{id}`). */
const ZONE_ID_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|zone-\d+)$/i;

/** Mirrors lite-adserver UNIQUE_USERS_MAX_VISITS / _MAX_HOURS. */
const UNIQUE_USERS_MAX_VISITS = 1000;
const UNIQUE_USERS_MAX_HOURS = 8760;

export async function fetchTargetingTypes(client: AffsetClient): Promise<TargetingRuleType[]> {
  const res = await client.get<TargetingRuleTypesResponse>("/api/targeting-rule-types");
  return res.targeting_rule_types ?? [];
}

export async function fetchTargetingRules(
  client: AffsetClient,
  campaignId: string,
): Promise<TargetingRule[]> {
  const res = await client.get<TargetingRulesResponse>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/targeting_rules`,
  );
  return res.targeting_rules ?? [];
}

/**
 * Write the campaign's full rule set. The endpoint is a sync, not an append:
 * every rule the caller wants to keep must be echoed back with its id, or it is
 * deleted. Callers build `rules` from a fresh read for exactly that reason.
 */
export async function syncTargetingRules(
  client: AffsetClient,
  campaignId: string,
  rules: TargetingRule[],
): Promise<TargetingRule[]> {
  const res = await client.post<TargetingRulesResponse>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/targeting_rules`,
    rules,
  );
  return res.targeting_rules ?? [];
}

/** Strip everything the sync endpoint does not accept back. */
export function toSyncPayload(rules: TargetingRule[]): TargetingRule[] {
  return rules.map((r) => ({
    ...(r.id !== undefined ? { id: r.id } : {}),
    targeting_rule_type_id: r.targeting_rule_type_id,
    targeting_method: r.targeting_method,
    rule: r.rule,
  }));
}

/** Resolve a caller-supplied type id or name against an already-fetched catalog. */
export function resolveTargetingType(
  types: TargetingRuleType[],
  type: string | number,
): { type: TargetingRuleType } | { error: string } {
  if (types.length === 0) {
    return { error: "No targeting rule types available in this tenant." };
  }

  const raw = String(type).trim();
  if (typeof type === "number" || /^\d+$/.test(raw)) {
    const id = typeof type === "number" ? type : parseInt(raw, 10);
    const match = types.find((t) => t.id === id);
    if (!match) {
      const known = types.map((t) => `${t.id}=${t.name}`).join(", ");
      return { error: `Unknown targeting type id ${id}. Known: ${known}.` };
    }
    return { type: match };
  }

  const name = raw.toLowerCase();
  const match = types.find((t) => t.name.toLowerCase() === name);
  if (!match) {
    const known = types.map((t) => t.name).join(", ");
    return { error: `Unknown targeting type "${type}". Known: ${known}.` };
  }
  return { type: match };
}

export type NormalizedRule = { value: string; notes: string[] };

/**
 * Normalise a rule value to the spelling the serve path compares against.
 * Returns an error for values that provably cannot match, and notes for values
 * that were rewritten or that could not be checked.
 */
export function normalizeRuleValue(
  typeName: string,
  rule: string,
): NormalizedRule | { error: string } {
  const raw = rule.trim();
  if (!raw) return { error: "rule must be a non-empty string." };

  switch (typeName.toLowerCase()) {
    case "geo":
      return normalizeList(raw, "geo", (value) => {
        if (!/^[A-Za-z]{2}$/.test(value)) {
          return {
            error:
              `"${value}" is not an ISO-3166 alpha-2 country code. ` +
              "Geo is matched against `CF-IPCountry` (e.g. BR, MX, IN).",
          };
        }
        return { value: value.toUpperCase() };
      });

    case "device_type":
      return normalizeList(raw, "device_type", (value) => {
        const lower = value.toLowerCase();
        if (!(DEVICE_TYPES as readonly string[]).includes(lower)) {
          return {
            error: `"${value}" is not a device type. Use ${DEVICE_TYPES.join(", ")}.`,
          };
        }
        return { value: lower };
      });

    case "os":
      return normalizeList(raw, "os", (value) => aliasOrWarn(value, OS_ALIASES, "OS"));

    case "browser":
      return normalizeList(raw, "browser", (value) =>
        aliasOrWarn(value, BROWSER_ALIASES, "browser"),
      );

    case "zone_id":
      return normalizeList(raw, "zone_id", (value) => {
        if (!ZONE_ID_RE.test(value)) {
          return {
            error:
              `"${value}" is not a zone id. Zone rules take zone UUIDs ` +
              "(see `list_zones`); anything else is dropped by the serve path.",
          };
        }
        return { value };
      });

    case "unique_users":
      return normalizeUniqueUsers(raw);

    default:
      return { value: raw, notes: [] };
  }
}

/** Apply `check` across a comma-separated list, de-duplicating the result. */
function normalizeList(
  raw: string,
  label: string,
  check: (value: string) => { value: string; note?: string } | { error: string },
): NormalizedRule | { error: string } {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return { error: `${label} rule must list at least one value.` };
  }

  const values: string[] = [];
  const notes: string[] = [];
  for (const part of parts) {
    const checked = check(part);
    if ("error" in checked) return checked;
    if (!values.includes(checked.value)) values.push(checked.value);
    if (checked.note) notes.push(checked.note);
  }

  const normalized = values.join(",");
  if (normalized !== raw) {
    notes.unshift(`Normalised \`${raw}\` → \`${normalized}\` to match the serve path.`);
  }
  return { value: normalized, notes };
}

/**
 * OS and browser names come from Bowser and cannot be enumerated safely — an
 * unknown value may be a real one this list has not seen. Pass it through, but
 * say so: an unmatched value in a whitelist stops the campaign serving.
 */
function aliasOrWarn(
  value: string,
  aliases: Record<string, string>,
  label: string,
): { value: string; note?: string } {
  const known = aliases[value.toLowerCase()];
  if (known) return { value: known };
  return {
    value,
    note:
      `⚠️ \`${value}\` is not a ${label} name this server recognises — it is stored as typed ` +
      `and matched exactly. Confirm it against a real ${label} value in \`get_stats\` first.`,
  };
}

/** `visits/hours`, matching lite-adserver `parseUniqueUsersRule`. */
function normalizeUniqueUsers(raw: string): NormalizedRule | { error: string } {
  const match = /^\s*(\d+)(?:\s*[/,]\s*(\d+))?\s*$/.exec(raw);
  if (!match) {
    return {
      error:
        `"${raw}" is not a unique_users rule. Use "visits/hours" (e.g. "1/24" for ` +
        "one impression per user per day). A malformed rule is skipped at serve time, " +
        "so the cap would silently not apply.",
    };
  }
  const visits = Number(match[1]);
  const hours = match[2] === undefined ? 24 : Number(match[2]);
  if (visits < 1 || visits > UNIQUE_USERS_MAX_VISITS) {
    return { error: `unique_users visits must be 1–${UNIQUE_USERS_MAX_VISITS} (got ${visits}).` };
  }
  if (hours < 1 || hours > UNIQUE_USERS_MAX_HOURS) {
    return { error: `unique_users hours must be 1–${UNIQUE_USERS_MAX_HOURS} (got ${hours}).` };
  }

  const value = `${visits}/${hours}`;
  const notes = value === raw ? [] : [`Normalised \`${raw}\` → \`${value}\` (visits/hours).`];
  return { value, notes };
}
