/** Shapes of the affset tenant API responses this server consumes. */

/** A single grouped row from `GET /api/stats`. */
export interface StatRow {
  // Grouping key columns (only the one matching `group_by` is populated).
  date?: string;
  campaign_id?: string;
  campaign_name?: string | null;
  zone_id?: string;
  zone_name?: string | null;
  country?: string | null;
  conversion_type?: string | null;
  publisher_email?: string | null;
  sub1?: string | null;
  sub2?: string | null;
  sub3?: string | null;
  sub4?: string | null;
  sub5?: string | null;

  // Metrics.
  impressions: number;
  fallbacks: number;
  unsold: number;
  clicks: number;
  conversions: number;
  spend?: number;
  payout?: number;
  media_cost?: number;
  /** (payout - media_cost) / media_cost; null when the slice carries no cost. */
  roi?: number | null;
}

export interface StatsResponse {
  stats: StatRow[];
  period: { from: number; to: number };
  /** Tenant display names for sub1..sub5 (e.g. sub1 -> "Zone"); {} when none set. */
  sub_labels?: SubLabels;
}

export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * One conversion from GET /api/conversions.
 *
 * spend/payout are absent (key missing) when the caller's role may not see them —
 * publisher-side roles lose `spend`, advertiser-side roles lose `payout`. `null`
 * is different: the column is visible and simply has no amount recorded. Consumers
 * that treat "no payout" as a signal have to tell the two apart.
 */
export interface Conversion {
  ad_event_id: string;
  namespace?: string;
  click_id: string | null;
  payload: string | null;
  spend?: number | null;
  payout?: number | null;
  source_click_id?: string | null;
  sub1?: string | null;
  sub2?: string | null;
  sub3?: string | null;
  sub4?: string | null;
  sub5?: string | null;
  /** Unix ms when the conversion was recorded. */
  created_at: number;
}

export interface ConversionsResponse {
  conversions: Conversion[];
  pagination: Pagination;
}

/** Campaign row from list/get. */
export interface Campaign {
  id: number;
  name: string;
  status: string;
  redirect_url?: string | null;
  payment_model?: string;
  rate?: number;
  start_date?: number | null;
  end_date?: number | null;
  user_email?: string | null;
  daily_budget?: number | null;
  total_budget?: number | null;
  pacing?: string;
  budget_paused?: number;
  budget_pause_reason?: string | null;
  silent?: number;
  payout_goal_type?: string | null;
  created_at?: number;
  updated_at?: number;
  targeting_rules?: TargetingRule[];
}

/** Response of POST /api/campaigns. */
export interface CreateCampaignResponse {
  id: number;
  name: string;
  status: string;
  created_at: number;
}

export interface CampaignsResponse {
  campaigns: Campaign[];
  pagination: Pagination;
}

export interface Zone {
  id: string;
  name: string;
  status: string;
  site_url?: string | null;
  traffic_back_url?: string | null;
  postback_url?: string | null;
  user_email?: string | null;
  manager_email?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface ZonesResponse {
  zones: Zone[];
  pagination: Pagination;
}

export interface CreateZoneResponse {
  id: string;
  status: string;
  created_at: number;
}

export interface UpdateZoneResponse {
  id: string;
  updated_at: number;
}

export interface UpdateCampaignResponse {
  id: number;
  updated_at: number;
}

/** Subset of GET /api/tenant this server reads. */
export interface TenantSettingsResponse {
  company?: string;
  /** IANA name; every date the tools render or resolve is in this zone. */
  timezone?: string;
  sub_labels?: SubLabels;
  /** Tenant's own API domain; "" when unset. Integration URLs must use it. */
  custom_api_domain?: string;
}

/** One payout rule from GET/POST /api/campaigns/{id}/payout_rules. */
export interface PayoutRule {
  id: number;
  campaign_id: number;
  zone_id: string | null;
  payout: number;
  created_at?: number;
}

export interface PayoutRulesResponse {
  payout_rules: PayoutRule[];
}

/**
 * One team member from GET /api/api-keys?type=user, or the response of
 * POST /api/api-keys?type=user (create).
 *
 * `token` is present in both. It is not a one-time secret — affset returns it
 * on every list call to a permitted role, same as the dashboard's "Copy token"
 * button — but `list_team` deliberately never echoes it anyway, since a
 * browsing-style "show my team" query is a bad place for live credentials to
 * repeatedly pass through model context. `create_team_member` is the
 * considered exception: it echoes the token exactly once, on the one call
 * that just minted it for the operator to hand to that person.
 */
export interface TeamMember {
  token?: string;
  namespace?: string;
  user_id?: string;
  email: string | null;
  role: string;
  created_at: number;
  expires_at?: number;
  permissions?: string[];
  manager_email?: string;
}

/** Response of POST /api/api-keys?type=user — same shape as TeamMember, token always present. */
export type CreateTeamMemberResponse = TeamMember & { token: string };

export interface TargetingRule {
  id?: number;
  campaign_id?: string | number;
  targeting_rule_type_id: number;
  targeting_method: "whitelist" | "blacklist";
  rule: string;
}

export interface TargetingRulesResponse {
  targeting_rules: TargetingRule[];
}

export interface TargetingRuleType {
  id: number;
  name: string;
  description?: string | null;
}

export interface TargetingRuleTypesResponse {
  targeting_rule_types: TargetingRuleType[];
}

/** The five traffic-source breakdown keys. */
export const SUB_KEYS = ["sub1", "sub2", "sub3", "sub4", "sub5"] as const;
export type SubKey = (typeof SUB_KEYS)[number];

/** Tenant display names for sub slots; only labeled slots are present. */
export type SubLabels = Partial<Record<SubKey, string>>;

/** Valid `group_by` dimensions accepted by `GET /api/stats`. */
export const GROUP_BY_VALUES = [
  "date",
  "campaign_id",
  "zone_id",
  "country",
  "conversion_type",
  "publisher_email",
  ...SUB_KEYS,
] as const;
export type GroupBy = (typeof GROUP_BY_VALUES)[number];

export const CAMPAIGN_STATUSES = ["active", "paused", "archived"] as const;
export const ZONE_STATUSES = ["active", "inactive"] as const;
export const PAYMENT_MODELS = ["cpa", "cpm"] as const;
export const PACING_VALUES = ["asap", "even"] as const;
