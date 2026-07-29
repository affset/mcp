# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
