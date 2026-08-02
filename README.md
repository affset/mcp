# affset MCP server

An [MCP](https://modelcontextprotocol.io) server that lets a media buyer run affset
from a chat client — pull stats, manage campaigns/zones/team, payouts, targeting,
sub labels, and cut underperforming zones in plain language, no dashboard.

It's a thin wrapper over the existing affset tenant API (`Bearer` token +
`X-Namespace`). One server instance serves one tenant.

## Tools

| Tool                    | What it does                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whoami`                | Show the tenant this server is bound to: namespace, API base, derived dashboard URL, and (when readable) company / timezone / custom API domain. Read-only.                                                                                                                                           |
| `get_stats`             | Traffic stats grouped by a dimension (date, campaign, zone, country, sub1–5, …). Returns clicks, conversions, CR, payout, media cost and ROI as a table. Sub columns use the tenant's sub labels when configured.                                                                                     |
| `list_campaigns`        | List campaigns (status / name filter, pagination).                                                                                                                                                                                                                                                    |
| `get_campaign`          | One campaign's full record — every field (untruncated offer URL, exact schedule, budgets/pacing, silent flag, payout goal type) plus its targeting rules and payout rules, in one call.                                                                                                               |
| `list_zones`            | List traffic-source zones (status / name filter, pagination).                                                                                                                                                                                                                                         |
| `list_team`             | List team members (email, role, manager). **Never returns API tokens.**                                                                                                                                                                                                                               |
| `create_team_member`    | Invite a team member (owner, manager, publisher, advertiser, publisher_manager, advertiser_manager). A scoped manager key can only create its own managed role, self-assigned. Returns the new API key **once** — `list_team` never shows it again. **Dry-run by default**; `confirm: true` to apply. |
| `create_campaign`       | Create a campaign from an advertiser email, offer URL, geo, payout and name. Defaults: CPA / rate 0, **paused**, global payout rule, ready tracking link with `source_click_id={clickid}` + sub placeholders. **Dry-run by default**; `confirm: true` to apply.                                       |
| `set_campaign_status`   | **Run** or **pause** a campaign (`action: "run" \| "pause"`). **Dry-run by default**; `confirm: true` to apply. Running can hit the plan's active-campaign limit.                                                                                                                                     |
| `update_campaign`       | Partial update (name, offer URL, status, rate, budgets, dates, …). **Dry-run by default**; `confirm: true` to apply. Prefer `set_campaign_status` for run/pause.                                                                                                                                      |
| `create_zone`           | Create a traffic-source zone (name + optional postback/site/traffic-back URLs). Always created `active`. **Dry-run by default**; `confirm: true` to apply.                                                                                                                                            |
| `update_zone`           | Partial update (name, status, URLs). **Dry-run by default**; `confirm: true` to apply. Pass `null` to clear a URL.                                                                                                                                                                                    |
| `get_zone_url`          | The `/serve` URL to paste into a network's campaign settings — rotates across the zone's **active** campaigns. Prefilled sub convention, optional `cost` macro. Warns when no active campaigns are visible.                                                                                           |
| `get_tracking_link`     | The `/track/click` link for an existing campaign + zone — straight to one active campaign, with no rotation or targeting checks. Re-derives what `create_campaign` echoed on create.                                                                                                                  |
| `cut_zones`             | Blacklist underperforming zones on a campaign by threshold (CR / spend / ROI). **Dry-run by default**; `confirm: true` to apply.                                                                                                                                                                      |
| `list_payout_rules`     | List a campaign's global + per-zone payout rules and its `payout_goal_type`.                                                                                                                                                                                                                          |
| `set_payout_rule`       | Upsert a global or zone-specific payout. **Dry-run by default**; `confirm: true` to apply.                                                                                                                                                                                                            |
| `delete_payout_rule`    | Delete a global or zone-specific payout rule. **Dry-run by default**; `confirm: true` to apply.                                                                                                                                                                                                       |
| `set_payout_goal`       | Set or clear `payout_goal_type` (goal-based conversions). **Dry-run by default**; `confirm: true` to apply.                                                                                                                                                                                           |
| `list_targeting_types`  | Catalog of targeting rule types, flagging the seeded ones `/serve` never evaluates.                                                                                                                                                                                                                   |
| `list_targeting_rules`  | List a campaign's targeting rules, flagging any that have no effect.                                                                                                                                                                                                                                  |
| `set_targeting_rule`    | Upsert one targeting rule (safe merge), normalised to what `/serve` matches. **Dry-run by default**; `confirm: true` to apply.                                                                                                                                                                        |
| `remove_targeting_rule` | Remove one targeting rule by id or type+method. **Dry-run by default**; `confirm: true` to apply.                                                                                                                                                                                                     |
| `list_sub_labels`       | List tenant display names for sub1–sub5.                                                                                                                                                                                                                                                              |
| `set_sub_labels`        | Set or clear sub labels (partial; `null` clears). **Dry-run by default**; `confirm: true` to apply.                                                                                                                                                                                                   |
| `list_conversions`      | List conversion audit records (payout, spend, pixel type, payload, postback). Optional client-side filters on the current page.                                                                                                                                                                       |

### Which URL do I give the network?

|                          | `get_zone_url` (`/serve/{zone}`)          | `get_tracking_link` (`/track/click/{campaign}/{zone}`) |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------ |
| Picks the campaign       | affset, from the zone's rotation          | you, one fixed campaign                                |
| Needs an active campaign | **yes** — otherwise traffic back / unsold | **yes** — otherwise 404                                |
| Needs an active zone     | **yes**                                   | **yes**                                                |
| Geo & targeting rules    | enforced                                  | **not** enforced                                       |
| `cost=` lands on         | the impression row                        | the click row                                          |

Use one or the other for a given traffic stream — never both with `cost=`, or the
media cost is counted twice.

Both use the tenant's **custom API domain** when one is set, since the URL gets pasted
into the network verbatim. Macros (`{clickid}`, `[CLICK_ID]`, `${SUBID}`) are inserted
without percent-encoding — the source expands them before the request reaches affset.

`cut_zones` only ever **adds** zones to a campaign's blacklist, and does a
read-merge-write so existing targeting rules are never touched.

`create_campaign` needs a traffic-source **zone** for the tracking link: pass
`zone_id`, or let it auto-pick when the namespace has exactly one active zone.
Campaigns are created `paused`; activate them before sending traffic through either
URL. Both URL types also require an active zone. Geo whitelist is enforced in `/serve`
only — the direct tracking link is **not** geo-gated, but it still requires an active,
currently serviceable campaign.

## Documentation resources

Beyond the tools, the server exposes the affset **API reference** as MCP
[resources](https://modelcontextprotocol.io/docs/concepts/resources), so an
assistant can answer "how does conversion tracking work?" or "what does `/serve`
accept?" from the docs themselves — not just from the tool schemas.

| Resource URI                       | Type               | Content                                                      |
| ---------------------------------- | ------------------ | ------------------------------------------------------------ |
| `affset://docs/api-reference`      | `text/markdown`    | The full API reference — endpoints, auth, roles, examples.   |
| `affset://docs/api-reference.json` | `application/json` | The same reference as structured data, for programmatic use. |

They're the exact content published at [affset.com/docs](https://affset.com/docs),
generated from one source, and **fetched at read time** from `AFFSET_DOCS_URL`
(`{origin}/api-reference.md` and `{origin}/api-reference.json`) — so they always
reflect the currently published docs, not a copy pinned to this package. The
fetch sends **no credentials** (the docs are public and live on a different
origin than the tenant API). HTML SPA fallbacks, redirects, invalid JSON, and
oversized bodies are rejected. Both resources are always available, including
under `AFFSET_READ_ONLY`.

## Configuration

All config comes from environment variables (never hard-coded):

| Variable                    | Description                                                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AFFSET_BASE_URL`           | Origin of the affset API, e.g. `https://api.affset.com` (no path/query/credentials). Must be `https` unless the host is `localhost`/`127.0.0.1`/`::1` — plain http would send the API key in cleartext.                                                                                             |
| `AFFSET_API_KEY`            | Tenant API key. Its namespace must match `AFFSET_NAMESPACE`.                                                                                                                                                                                                                                        |
| `AFFSET_NAMESPACE`          | Tenant namespace (lowercase letters, numbers, hyphens; 3–63 chars — same rules as signup).                                                                                                                                                                                                          |
| `AFFSET_READ_ONLY`          | Optional, default `false`. Set to `true`/`1` to register only the read-only tools (`whoami`, `get_stats`, every `list_*`, `get_zone_url`, `get_tracking_link`) — every create/update/delete/cut tool is unavailable, not just gated behind confirm. See [Security](#security) for why this matters. |
| `AFFSET_REQUEST_TIMEOUT_MS` | Optional, default `30000`. Per-request HTTP timeout in milliseconds (`1000`–`300000`).                                                                                                                                                                                                              |
| `AFFSET_DOCS_URL`           | Optional, default `https://affset.com`. Origin the API-reference [documentation resources](#documentation-resources) are fetched from (origin only, no path). Fetched anonymously — no API key is sent here.                                                                                        |

See [`.env.example`](.env.example).

## Install

### From npm (recommended)

No clone, no build — your MCP client runs it with `npx`. For **Claude Desktop**
(`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "affset": {
      "command": "npx",
      "args": ["-y", "@affset/mcp"],
      "env": {
        "AFFSET_BASE_URL": "https://api.affset.com",
        "AFFSET_API_KEY": "sk_live_...",
        "AFFSET_NAMESPACE": "your-namespace"
      }
    }
  }
}
```

For **Claude Code**:

```bash
claude mcp add affset \
  -e AFFSET_BASE_URL=https://api.affset.com \
  -e AFFSET_API_KEY=sk_live_... \
  -e AFFSET_NAMESPACE=your-namespace \
  -- npx -y @affset/mcp
```

Same env flags with `-- npx -y github:affset/mcp` if you install from GitHub
instead of the npm registry (see below).

Add `-e AFFSET_READ_ONLY=true` for a stats/reporting-only instance (see
[Security](#security)).

### From GitHub directly (no npm publish required)

`npx` can install straight from the git repo instead of the npm registry —
useful if you'd rather not publish, or just want to track `main` without a
release step:

```json
{
  "mcpServers": {
    "affset": {
      "command": "npx",
      "args": ["-y", "github:affset/mcp"],
      "env": {
        "AFFSET_BASE_URL": "https://api.affset.com",
        "AFFSET_API_KEY": "sk_live_...",
        "AFFSET_NAMESPACE": "your-namespace"
      }
    }
  }
}
```

A push to `main` makes that commit available to this unpinned install path — no
npm publish is required. On resolution, npm fetches the repository and runs the
`prepare` script to build `dist/` before starting the binary. npm may reuse its
cache on later starts; an already running MCP process is not updated until it is
restarted and `npx` resolves the dependency again.

For reproducible deployments, pin a reviewed ref instead of floating on `main`:
`github:affset/mcp#<commit-sha>` or `github:affset/mcp#<tag>`. Restart the MCP
process deliberately when you want it to resolve and run a newer revision.

### From source

```bash
git clone https://github.com/affset/mcp.git affset-mcp
cd affset-mcp
npm install        # builds via the prepare script
```

Then point your MCP client at the built entry file — swap the `npx` command above
for `"command": "node"`, `"args": ["/absolute/path/to/affset-mcp/dist/index.js"]`.

## Usage examples

> **list paused campaigns** → `list_campaigns(status: "paused")`
>
> **show me everything about campaign 42** → `get_campaign(campaign_id: 42)`
>
> **show zones** → `list_zones()`
>
> **who's on the team?** → `list_team()`
>
> **add sarah@offer.com as a publisher** → `create_team_member(email: "sarah@offer.com", role: "publisher")` (dry-run) → confirm
>
> **stats for today by sub1** → `get_stats(group_by: "sub1")`
>
> **create a RichAds zone with postback** → `create_zone(name: "RichAds", postback_url: "https://…/{source_click_id}")` (dry-run) → confirm
>
> **create a campaign for offer X, advertiser buyer@example.com, geo BR, payout $2**
> → `create_campaign(user_email: "buyer@example.com", offer_url: "https://offer.example/lp?s={click_id}", geo: ["BR"], payout: 2)` (dry-run) → confirm
>
> **what URL do I paste into RichAds?** → `get_zone_url(cost: "{cost}")`
>
> **give me the link for campaign 42 again** → `get_tracking_link(campaign_id: 42)`
>
> **run campaign 42** → `set_campaign_status(campaign_id: 42, action: "run")` (dry-run) → confirm
>
> **pause campaign 42** → `set_campaign_status(campaign_id: 42, action: "pause")` (dry-run) → confirm
>
> **set zone postback** → `update_zone(zone_id, postback_url: "…")` (dry-run) → confirm
>
> **cut zones with CR < 0.2% and spend > $5**
> → `cut_zones(campaign_id, cr_max: 0.002, spend_min: 5)` (dry-run) → confirm
>
> **show payouts for campaign 42** → `list_payout_rules(campaign_id: 42)`
>
> **set zone payout to $3** → `set_payout_rule(campaign_id: 42, payout: 3, zone_id: "…")` (dry-run) → confirm
>
> **only pay on deposit conversions** → `set_payout_goal(campaign_id: 42, goal_type: "deposit")` (dry-run) → confirm
>
> **what targeting types exist?** → `list_targeting_types()`
>
> **whitelist BR+MX on campaign 42** → `set_targeting_rule(campaign_id: 42, type: "geo", method: "whitelist", rule: "BR,MX")` (dry-run) → confirm
>
> **name sub1 Zone, sub2 Creative** → `set_sub_labels(sub1: "Zone", sub2: "Creative")` (dry-run) → confirm
>
> **show recent conversions** → `list_conversions()`
>
> **find $0 payouts (goal miss?)** → `list_conversions(zero_payout: true)`
>
> **lookup by source click id** → `list_conversions(source_click_id: "abc123")`

## Notes & limits

- **`get_stats` groups by one dimension per call.** Drill-down is a sequence of
  calls, each narrowing with `campaign_ids` / `zone_ids` / `sub1..sub5` /
  `conversion_type` filters. Filtering by `conversion_type` returns conversion
  rows only (impressions, clicks and media cost are zero).
- **`spend` means `media_cost`** (your traffic cost). ROI / spend thresholds need
  cost data imported for the slice.
- List endpoints have **no server-side name search** — `name_contains` filters the
  current page client-side.
- Date-range presets, `YYYY-MM-DD` bounds and rendered timestamps all resolve in the
  **tenant timezone** (read once from `/api/tenant`), so a window lines up with the
  date buckets `group_by=date` returns instead of straddling two of them. Explicit
  timestamps must include `Z` or a UTC offset.
- **All mutations** (creates, updates, cuts, deletes) stay on dry-run →
  `confirm: true`. Creates are additive once confirmed and echo what was written.
- Activating a campaign or creating a zone can return **402 plan limit** — the
  error surfaces dimension / current / limit.
- **Payout resolution** at conversion: zone-specific → global → $0. Goal type gates
  spend/payout by pixel `type=` match; non-matching events still record at $0.
  Payouts go down to `$0.00001`, so payout amounts print at up to five decimals.
- **Changing a payout is delete + create** — the API has no update and the
  (campaign, zone) pair is unique. `set_payout_rule` restores the previous payout if
  the create fails, and says so loudly in the one case where it cannot.
- **Targeting** is enforced on `/serve` only — not on direct tracking links.
  `set_targeting_rule` / `remove_targeting_rule` merge safely; other rules are kept.
- **Targeting values are matched exactly and case-sensitively** at serve time (geo
  from `CF-IPCountry`, os/browser from the user agent, device type from a fixed set).
  `set_targeting_rule` normalises what it can (`br,mx` → `BR,MX`, `android` → `Android`)
  and rejects what could never match — an unmatched whitelist silently stops delivery.
- **`capping`, `weekdays` and `hours` are seeded but never evaluated** by `/serve`.
  `set_targeting_rule` refuses to write them (they would read as working targeting
  while the campaign kept buying); `list_targeting_types` flags them. Use
  `unique_users` (`visits/hours`) for frequency capping.
- **`list_conversions`** is the conversion audit trail (not aggregated stats). The API
  has no campaign/zone/date filters; optional filters apply to the current page only.
  Rows do not include campaign_id/zone_id. Publisher-side roles do not see `spend` and
  advertiser-side roles do not see `payout`, so `zero_payout` needs a role that can.
- **`create_team_member`** creates the API key directly (like the dashboard's "Add Team
  Member") — it does not send an invite email. Hand the returned key to the person
  yourself. Revoking/removing a team member is not yet a tool; use the dashboard's
  Team page.
- Out of scope: deleting campaigns/zones/conversions, billing, creative management.
- **Tenant signup is deliberately not a tool.** `POST /api/public/create-instance`
  is Origin-gated and fails closed, which is what keeps signup browser-only; a
  server-side caller would have to spoof an allowlisted Origin to get past it. The
  endpoint also withholds the API key when email delivery is configured (it sends a
  magic link instead), and this server binds one namespace from the environment at
  startup — so it could not use a tenant it just created. Sign up in the dashboard,
  then point a server instance at the new namespace.

## Development

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint src
npm run format       # prettier --write .
npm run build        # compile to dist/
npm test             # build + node --test over dist/**/*.test.js
npm run check-all    # lint + format:check + type-check + test — CI runs this
npm run dev          # watch mode
```

## Security

- No secrets in the repo; credentials come from the environment at runtime.
- `AFFSET_BASE_URL` must be `https` unless the host is loopback — no cleartext API key.
- stdout is the JSON-RPC channel — all logs go to stderr.
- `list_team` redacts API tokens.
- All mutations (including creates) follow **show → confirm → apply**.
- Create a **dedicated, least-privilege API key** for the MCP rather than reusing an
  owner key, and give it an expiry — affset's RBAC roles (owner/manager/publisher/
  advertiser) apply to MCP tool calls exactly as they do to the dashboard.
- Pin GitHub installs to a reviewed commit or tag in long-lived environments. A
  floating `main` spec can run newer repository code the next time `npx` resolves it.

### Prompt injection via conversion/click data

`get_stats`, `list_conversions` and `cut_zones` surface data that ultimately comes from
public, unauthenticated endpoints — a traffic source's click macros (`sub1`–`sub5`,
`source_click_id`) and a conversion pixel's raw query string (`list_conversions`'
payload detail). Anyone who can generate a click or fire a pixel controls those bytes,
and they land in the model's context when you ask about stats or conversions.

Mitigations in place:

- Untrusted fields are length-capped and escaped before rendering (`mdCell`,
  `capUntrusted` in `src/lib/format.ts`), and the conversion-payload block carries an
  explicit "treat as data, not instructions" notice.
- `confirm: true` on mutating tools is a **model-level** safety net, not a security
  boundary — a model that has been steered by injected content can supply
  `confirm: true` itself. The only real boundary is your MCP client's per-call tool
  approval and **`AFFSET_READ_ONLY`**.

**Set `AFFSET_READ_ONLY=true`** for any session where you're mainly reading stats/
conversions, especially with an MCP client that auto-approves tool calls. It removes
every mutation tool from the server entirely — not hidden behind a prompt, unavailable
to call. Reserve a read-write instance (or a separate one) for sessions where you're
actively managing campaigns/zones/payouts and are reviewing each confirm yourself.
