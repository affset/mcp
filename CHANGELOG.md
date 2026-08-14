# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0]

### Added

- The package is now importable as a runtime-agnostic library:
  `@affset/mcp/core` (also the root export) exposes `registerAffsetTools`,
  `AffsetClient`, `Config`, the docs-feed helpers, and `VERSION`, with
  TypeScript declarations. `registerAffsetTools(server, config)` registers the
  complete tool roster + docs resources and applies read-only stripping — the
  single source of truth shared by the stdio server and the hosted affset MCP
  gateway (`mcp.affset.com`), so the two transports cannot drift.
- Golden roster tests pin the exact tool lists (full and read-only); the
  gateway asserts the same lists over live `tools/list`.
- An optional metadata-only `onToolCall` hook lets hosted transports emit
  audit events without exposing tool arguments or output.
- Runtime config supplied through the library API is validated and normalized
  before tools are registered, including HTTPS enforcement for bearer-key API
  origins and fail-closed validation of the read-only flag.
- Tenant API and documentation responses are streamed under hard byte limits;
  oversized upstream bodies are cancelled before they can exhaust a hosted
  Worker or flood model context.

### Changed

- The stdio entrypoint is unchanged in behavior (env config, dry-run defaults,
  `AFFSET_READ_ONLY`) — it now delegates registration to the shared helper.
- The supported Node.js floor is now 22.13; CI covers Node 22 and 24 instead of
  end-of-life Node 18/20 releases that the current toolchain no longer supports.
- `server.ts` no longer reads `package.json` via `node:module`'s
  `createRequire` (Workers-incompatible); the version is a checked constant.
- The public declaration graph no longer references `NodeJS.ProcessEnv`, so
  Worker and browser-oriented TypeScript consumers do not need `@types/node`.
- Production transitive dependencies were refreshed to patched releases; the
  production dependency audit is clean.
- Read-only mode never registers mutating tools (previously registered then
  immediately removed), so the boundary does not depend on the SDK unlisting
  them after the fact.

### Fixed

- Cancelling an oversized streamed response cannot mask the size-limit error
  behind a follow-up `releaseLock()` throw.

## [0.1.4]

### Added

- `get_stats` accepts a `conversion_type` filter (comma-separated; `""` for
  untyped). Matches conversion rows only, so impressions/clicks/media cost
  are zero — documented in the tool description so agents don't misread CR.
- `get_stats` can `group_by` `advertiser_email` / `publisher_email`, and also
  filter by those emails independently of `group_by` (same role limits as the
  API: owner/manager plus the matching scoped manager).

### Fixed

- `SECURITY.md` trust-model note lists all six RBAC roles (adds
  `advertiser_manager` / `publisher_manager`).

### Changed

- Drop unused `PayoutRuleResponse` type alias.

## [0.1.3]

### Added

- `get_campaign` — one campaign's full record (every field, including the
  untruncated offer URL, exact schedule, budgets/pacing, silent-conversions
  flag, and payout goal type) plus its targeting rules and payout rules, in a
  single call. `list_campaigns` stays a scannable summary (offer URL
  truncated, no dates/pacing/silent); use `get_campaign` when you need one
  campaign's complete data, e.g. before recreating it as a new campaign.

## [0.1.2]

### Added

- Remote API-reference MCP resources (`affset://docs/api-reference` and related)
  so clients can pull the live docs without leaving chat.
- `glama.json` to claim MCP server maintainership on Glama.

## [0.1.1]

### Changed

- `create_campaign` and `create_zone` now follow the same dry-run →
  `confirm: true` flow as every other mutation (they previously applied
  immediately).
- `AFFSET_NAMESPACE` is validated at startup (lowercase alnum + hyphens, 3–63
  chars) so `whoami`'s dashboard URL cannot embed arbitrary config junk.
- HTTP client refuses absolute / protocol-relative paths so a future tool cannot
  accidentally turn `new URL(path, base)` into cross-origin SSRF.
- `AFFSET_READ_ONLY` rejects misspelled boolean values instead of silently enabling
  write tools; base URLs and request timeouts now fail fast on unsafe shapes.
- Campaign date-only schedules now resolve in the tenant timezone, and impossible
  calendar dates are rejected instead of rolling into the following month. The
  update fails closed if the timezone cannot be read rather than assuming UTC;
  timestamp inputs require an explicit `Z`/UTC offset so host timezone never leaks
  into scheduling or stats ranges.
- Source maps are excluded from the published npm tarball.
- `create_campaign` payout amounts render with `moneyPrecise` (up to five
  decimals), matching payout-rule tools.

### Added

- MCP Registry metadata: `mcpName` in `package.json` and a root `server.json`
  (`io.github.affset/mcp`, npm / stdio package with documented env vars) so the
  server can be listed in the official registry via `mcp-publisher publish`.
- `create_team_member` tool: invite a team member (owner, manager, publisher,
  advertiser, publisher_manager, advertiser_manager) — the gap where an owner
  had no way to add a publisher/advertiser without leaving chat for the
  dashboard. A scoped manager key can only create its own managed role,
  self-assigned; the API enforces this, not the tool. Returns the new API key
  once, in the confirmed response — `list_team` still never echoes tokens.
  Dry-run by default. Bounds the echoed token length so a malformed API
  response cannot flood model context.
- `create_campaign` points operators at `create_team_member` when the advertiser
  email does not exist yet.
- Regression coverage for configuration and client hardening, mutation
  confirmation, read-only tool registration, and tenant-timezone scheduling.
- README: install directly from GitHub (`npx -y github:affset/mcp`) as an
  alternative to the npm registry — no npm publish step. Documents restart/cache
  behavior and recommends commit/tag pins for reproducible deployments.

## [0.1.0]

Initial public release: `get_stats`, `cut_zones`, campaign / zone / payout /
targeting / sub-label / team / conversion tools over the affset tenant API.

- `AFFSET_READ_ONLY` environment flag. When set, only read-only tools are
  registered — every create / update / delete / cut tool is removed from the
  server, not just gated behind `confirm`.
- `whoami` tool: reports the tenant the server is bound to.
- Untrusted-data handling: conversion payloads, subs, and source/click ids are
  length-capped and escaped before rendering.
- `AFFSET_BASE_URL` must be `https` for non-loopback hosts.
- CI (`check-all` on Node 18/20/22) + `npm publish --dry-run`, Dependabot,
  ESLint, Prettier, MIT license, `SECURITY.md`, `CONTRIBUTING.md`.
