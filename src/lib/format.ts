import { SUB_KEYS, type GroupBy, type StatRow, type SubKey, type SubLabels } from "../types.js";

/**
 * Escape a value for a Markdown table cell. Pipes/newlines break table layout;
 * backticks and brackets are escaped too since these cells often carry
 * traffic-source-controlled strings (zone names, sub values) rendered straight
 * into the model's context — unescaped backticks let that data break out of its
 * cell and forge what reads like a fenced code block or inline instruction.
 */
export function mdCell(value: string): string {
  return value
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\r?\n/g, " ")
    .trim();
}

const DEFAULT_UNTRUSTED_CAP = 500;

/**
 * Truncate a value that came from outside the tenant's own dashboard — sub values,
 * zone/campaign names on rows the API returned, conversion payloads — before it
 * reaches the model's context. These fields round-trip through public, unauthenticated
 * endpoints (a click, a conversion pixel), so nothing bounds their length or content
 * on the way in; without a cap here, one long field could bury an injected
 * instruction past whatever a client renders or a reviewer reads.
 */
export function capUntrusted(value: string, max: number = DEFAULT_UNTRUSTED_CAP): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

/** Format a number as USD, e.g. 1234.5 -> "$1,234.50". */
export function money(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a USD amount that can be smaller than a cent. Payout rules accept down
 * to $0.00001 and push/mVAS payouts really do sit there, where `money()`'s two
 * decimals would render $0.005 as "$0.00" — a preview the operator would confirm
 * believing it said something else. Ordinary amounts still show two decimals.
 */
export function moneyPrecise(n: number | undefined | null): string {
  if (n === undefined || n === null) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 5 })}`;
}

/** Format a fraction as a percentage, e.g. 0.0145 -> "1.45%". */
export function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(2)}%`;
}

/** Format ROI (a fraction) with sign, e.g. 0.35 -> "+35%". Null -> "—". */
export function roi(fraction: number | null | undefined): string {
  if (fraction === undefined || fraction === null) return "—";
  const sign = fraction >= 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(0)}%`;
}

/** Conversion rate for a row (conversions / clicks), 0 when no clicks. */
export function conversionRate(row: StatRow): number {
  return row.clicks > 0 ? row.conversions / row.clicks : 0;
}

/** The human label for a row given the grouping dimension. */
export function rowLabel(row: StatRow, groupBy: GroupBy): string {
  switch (groupBy) {
    case "date":
      return row.date ?? "—";
    case "campaign_id":
      return row.campaign_name ?? row.campaign_id ?? "—";
    case "zone_id":
      return row.zone_name ?? row.zone_id ?? "—";
    case "country":
      return row.country || "(none)";
    case "conversion_type":
      // From the conversion pixel's `type=` query param — a public, unauthenticated
      // endpoint, so this is attacker-controlled free text, not a tenant setting.
      return capUntrusted(row.conversion_type || "(none)");
    case "publisher_email":
      return row.publisher_email || "(none)";
    case "advertiser_email":
      return row.advertiser_email || "(none)";
    default:
      // sub1..sub5 — attributed from click/pixel query params, same trust level.
      return capUntrusted(row[groupBy] || "(none)");
  }
}

const HEADER_BY_GROUP: Record<GroupBy, string> = {
  date: "Date",
  campaign_id: "Campaign",
  zone_id: "Zone",
  country: "Country",
  conversion_type: "Conv. type",
  publisher_email: "Publisher",
  advertiser_email: "Advertiser",
  sub1: "sub1",
  sub2: "sub2",
  sub3: "sub3",
  sub4: "sub4",
  sub5: "sub5",
};

/**
 * Column title for a grouping: for sub1..sub5 the tenant's label (from the stats
 * response `sub_labels`) with the raw key appended for addressability —
 * "Zone (sub1)" — since filters/group_by still take the raw key. Raw key otherwise.
 */
export function groupHeader(groupBy: GroupBy, subLabels?: SubLabels): string {
  if ((SUB_KEYS as readonly string[]).includes(groupBy)) {
    const label = subLabels?.[groupBy as SubKey]?.trim();
    if (label) return `${label} (${groupBy})`;
  }
  return HEADER_BY_GROUP[groupBy];
}

/**
 * Render grouped stats as a Markdown table with a totals row. CR is derived
 * client-side; ROI comes from the API (blank until media_cost is populated).
 */
export function formatStatsTable(rows: StatRow[], groupBy: GroupBy, subLabels?: SubLabels): string {
  if (rows.length === 0) return "_No data for this period._";

  const header = groupHeader(groupBy, subLabels);
  const lines: string[] = [
    `| ${header} | Impr | Clicks | Conv | CR | Payout | Cost | ROI |`,
    "|---|--:|--:|--:|--:|--:|--:|--:|",
  ];

  let tImpr = 0;
  let tClicks = 0;
  let tConv = 0;
  let tPayout = 0;
  let tCost = 0;
  let anyCost = false;

  for (const row of rows) {
    tImpr += row.impressions ?? 0;
    tClicks += row.clicks;
    tConv += row.conversions;
    tPayout += row.payout ?? 0;
    tCost += row.media_cost ?? 0;
    if ((row.media_cost ?? 0) > 0) anyCost = true;

    lines.push(
      `| ${mdCell(rowLabel(row, groupBy))} | ${row.impressions ?? 0} | ${row.clicks} | ${
        row.conversions
      } | ${pct(conversionRate(row))} | ${money(row.payout)} | ${money(row.media_cost)} | ${roi(
        row.roi,
      )} |`,
    );
  }

  const totalCr = tClicks > 0 ? tConv / tClicks : 0;
  const totalRoi = anyCost && tCost > 0 ? (tPayout - tCost) / tCost : null;
  lines.push(
    `| **Total** | **${tImpr}** | **${tClicks}** | **${tConv}** | **${pct(totalCr)}** | **${money(
      tPayout,
    )}** | **${money(tCost)}** | **${roi(totalRoi)}** |`,
  );

  if (!anyCost) {
    lines.push("");
    lines.push("_Cost/ROI are blank — media_cost not populated for this slice._");
  }

  return lines.join("\n");
}
