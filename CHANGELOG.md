# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `AFFSET_READ_ONLY` environment flag. When set, only read-only tools are
  registered — every create / update / delete / cut tool is removed from the
  server, not just gated behind `confirm`. Recommended for reporting sessions and
  auto-approving MCP clients.
- `whoami` tool: reports the tenant the server is bound to (namespace, API base,
  derived dashboard URL, and — when readable — company, timezone, custom API
  domain).
- Untrusted-data handling: conversion payloads, subs, and source/click ids are now
  length-capped and escaped before rendering, and the conversion-payload block is
  explicitly labelled as untrusted third-party data.
- `MIT` license, `SECURITY.md`, `CONTRIBUTING.md`, and this changelog.
- CI (`.github/workflows/ci.yml`): `check-all` on Node 18/20/22, plus an
  `npm publish --dry-run` job to catch packaging regressions before a release.
- Dependabot for npm and GitHub Actions, weekly.
- ESLint (flat config, typescript-eslint) and Prettier; `npm run lint` /
  `npm run format` / `npm run check-all` gate on both.

### Changed

- `AFFSET_BASE_URL` must be `https` for non-loopback hosts; plain `http` is
  rejected so the API key is never sent in cleartext.
- `mdCell` now escapes backticks and `[` in addition to pipes and newlines, so
  attacker-influenced table cells cannot forge Markdown structure.

## [0.1.0]

Initial internal release: `get_stats`, `cut_zones`, campaign / zone / payout /
targeting / sub-label / team / conversion tools over the affset tenant API.
