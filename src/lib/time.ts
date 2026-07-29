/**
 * Date-range resolution for stats queries.
 *
 * Every boundary here is computed in the TENANT's timezone, not the timezone of
 * the machine running this server. The API buckets `group_by=date` by the tenant
 * timezone, so resolving "today" against the operator's laptop clock would ask
 * for a window that straddles two of the buckets it gets back — a single "today"
 * arriving as two partial rows. Callers fetch the tenant timezone (see
 * AffsetClient#getTenantTimezone) and pass it in.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/i;
const MAX_DATE_MS = 8_640_000_000_000_000;

export const RANGE_PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "last_30_days",
  "this_month",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface ResolvedRange {
  /** Inclusive lower bound, epoch ms. */
  from: number;
  /** Inclusive upper bound, epoch ms. */
  to: number;
  /** Human label for display. */
  label: string;
}

/** A calendar day with no zone attached. `m` is 0-based, matching Date. */
interface CalendarDay {
  y: number;
  m: number;
  d: number;
}

function parseCalendarDay(value: string): CalendarDay {
  const [y, month, d] = value.split("-").map(Number);
  const m = month - 1;
  const check = new Date(Date.UTC(y, m, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m || check.getUTCDate() !== d) {
    throw new Error(`Invalid date "${value}". Use a real YYYY-MM-DD calendar date.`);
  }
  return { y, m, d };
}

/**
 * UTC offset in ms of `timeZone` at a specific instant. Resolved per instant
 * rather than per day because a zone's offset changes partway through a DST
 * transition day.
 */
function offsetMsAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (name: string) => parseInt(parts.find((p) => p.type === name)?.value ?? "0", 10);
  // en-CA with hour12:false renders midnight as "24"; normalise it.
  const hour = get("hour") % 24;
  const localAsUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return localAsUtcMs - Math.floor(utcMs / 1000) * 1000;
}

/** Which calendar day an instant falls on, in the given timezone. */
function calendarDayIn(utcMs: number, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (name: string) => parseInt(parts.find((p) => p.type === name)?.value ?? "0", 10);
  return { y: get("year"), m: get("month") - 1, d: get("day") };
}

/** Shift a calendar day by whole days. Zone-free arithmetic; handles rollover. */
function addDays(day: CalendarDay, n: number): CalendarDay {
  const t = new Date(Date.UTC(day.y, day.m, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}

/**
 * Epoch ms for 00:00:00.000 on a calendar day in a timezone.
 *
 * Two passes: the offset we need is the one in force at local midnight, and that
 * is not knowable until the instant is. A fixed-hour guess is wrong on DST
 * transition days.
 */
function startOfDayMs(day: CalendarDay, timeZone: string): number {
  const wallClock = Date.UTC(day.y, day.m, day.d, 0, 0, 0, 0);
  const firstGuess = wallClock - offsetMsAt(wallClock, timeZone);
  return wallClock - offsetMsAt(firstGuess, timeZone);
}

/**
 * Epoch ms for 23:59:59.999 on a calendar day in a timezone. Derived from the
 * next day's start so 23h and 25h days end on the right instant.
 */
function endOfDayMs(day: CalendarDay, timeZone: string): number {
  return startOfDayMs(addDays(day, 1), timeZone) - 1;
}

/** Format epoch ms as a YYYY-MM-DD calendar day in the tenant timezone. */
function fmtDay(ms: number, timeZone: string): string {
  const { y, m, d } = calendarDayIn(ms, timeZone);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse an explicit bound: epoch-ms string, YYYY-MM-DD calendar day, or ISO
 * timestamp with an explicit offset. Date-only strings are read as calendar
 * days in the tenant timezone — matching the presets and the API's date buckets
 * — and for `to` mean end-of-day so a full calendar day is included.
 */
function parseBound(
  value: string | undefined,
  role: "from" | "to",
  timeZone: string,
): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return parseEpochMs(Number(trimmed), value);

  if (DATE_ONLY.test(trimmed)) {
    const day = parseCalendarDay(trimmed);
    return role === "to" ? endOfDayMs(day, timeZone) : startOfDayMs(day, timeZone);
  }

  return parseIsoTimestamp(trimmed);
}

function parseEpochMs(value: number, original: string | number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DATE_MS) {
    throw new Error(
      `Invalid date "${original}". Epoch milliseconds must be a positive safe integer.`,
    );
  }
  return value;
}

function parseIsoTimestamp(value: string): number {
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) {
    throw new Error(
      `Invalid date "${value}". Use YYYY-MM-DD, epoch ms, or an ISO timestamp with Z/UTC offset.`,
    );
  }

  parseCalendarDay(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? 0);
  const offset = match[6];
  const offsetHour = offset === "Z" || offset === "z" ? 0 : Number(offset.slice(1, 3));
  const offsetMinute = offset === "Z" || offset === "z" ? 0 : Number(offset.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    throw new Error(`Invalid date "${value}". Timestamp contains an out-of-range time.`);
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid date "${value}". Use a valid ISO timestamp with Z/UTC offset.`);
  }
  return parsed;
}

/**
 * Parse one campaign schedule boundary. Date-only values use the tenant's
 * timezone; explicit ISO timestamps and epoch milliseconds remain exact.
 */
export function parseCampaignDateBound(
  value: string | number | null,
  role: "start" | "end",
  timeZone: string,
): number | null {
  if (value === null) return null;
  if (typeof value === "number") return parseEpochMs(value, value);

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return parseEpochMs(Number(trimmed), value);
  if (DATE_ONLY.test(trimmed)) {
    const day = parseCalendarDay(trimmed);
    return role === "end" ? endOfDayMs(day, timeZone) : startOfDayMs(day, timeZone);
  }

  return parseIsoTimestamp(trimmed);
}

/**
 * Resolve a range from an optional preset and/or explicit from/to bounds.
 * Explicit bounds win over the preset. All day boundaries are in `timeZone`
 * (the tenant's), so the window lines up with the API's date buckets.
 */
export function resolveRange(
  preset: RangePreset | undefined,
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): ResolvedRange {
  const explicitFrom = parseBound(from, "from", timeZone);
  const explicitTo = parseBound(to, "to", timeZone);
  const now = Date.now();
  const today = calendarDayIn(now, timeZone);

  if (explicitFrom !== undefined || explicitTo !== undefined) {
    const f = explicitFrom ?? startOfDayMs(today, timeZone);
    const t = explicitTo ?? now;
    if (f > t) {
      throw new Error(
        `Invalid range: from (${fmtDay(f, timeZone)}) is after to (${fmtDay(t, timeZone)}).`,
      );
    }
    return {
      from: f,
      to: t,
      label: `${fmtDay(f, timeZone)} → ${fmtDay(t, timeZone)}`,
    };
  }

  const startOfToday = startOfDayMs(today, timeZone);

  switch (preset ?? "today") {
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return {
        from: startOfDayMs(yesterday, timeZone),
        to: startOfToday - 1,
        label: "yesterday",
      };
    }
    case "last_7_days":
      // Calendar arithmetic, not `today - 6 * 86400000`: subtracting fixed
      // milliseconds slips an hour across a DST change and lands mid-day.
      return {
        from: startOfDayMs(addDays(today, -6), timeZone),
        to: now,
        label: "last 7 days",
      };
    case "last_30_days":
      return {
        from: startOfDayMs(addDays(today, -29), timeZone),
        to: now,
        label: "last 30 days",
      };
    case "this_month":
      return {
        from: startOfDayMs({ y: today.y, m: today.m, d: 1 }, timeZone),
        to: now,
        label: "this month",
      };
    case "today":
    default:
      return { from: startOfToday, to: now, label: "today" };
  }
}

/**
 * Format an instant as `YYYY-MM-DD HH:mm` in the tenant timezone. Row timestamps
 * have to agree with the date buckets stats are read in: a conversion at 23:30
 * tenant-local rendered in UTC lands on the next day's row and reads as a
 * missing conversion.
 */
export function formatInstant(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (name: string) => parseInt(parts.find((p) => p.type === name)?.value ?? "0", 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  // en-CA with hour12:false renders midnight as "24"; normalise it.
  return (
    `${get("year")}-${pad(get("month"))}-${pad(get("day"))} ` +
    `${pad(get("hour") % 24)}:${pad(get("minute"))}`
  );
}
