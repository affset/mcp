# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Email **security@affset.com** with details and, if possible, a reproduction. We
aim to acknowledge within 3 business days and to ship a fix or mitigation before
any public disclosure. Coordinated disclosure is appreciated.

## Scope

This repository is the affset MCP server — a thin, stdio-based client over the
affset tenant API. In scope: credential handling, the read-only enforcement of
`AFFSET_READ_ONLY`, input validation, and the handling of untrusted data that
reaches the model's context (see below). The affset API itself is a separate
system; report issues there through the same address.

## Trust model — read this before deploying

- **Credentials come from the environment only.** `AFFSET_API_KEY` is never read
  from, written to, or logged by this server. Point it at an `https` origin
  (enforced for non-loopback hosts) so the bearer token is never sent in
  cleartext.
- **Use a dedicated, least-privilege, expiring API key.** affset's RBAC roles
  (owner / manager / publisher / advertiser) apply to MCP tool calls exactly as
  they do in the dashboard. Do not hand the server an owner key if a scoped key
  will do.
- **Some tool output is attacker-influenced.** `get_stats`, `list_conversions`,
  and `cut_zones` surface `sub1`–`sub5`, `source_click_id`, and raw conversion
  pixel payloads. Those originate from public, unauthenticated endpoints (a click,
  a pixel fire), so their bytes are controlled by whoever generates the traffic —
  and they land in your model's context. The server length-caps and escapes these
  fields and labels the conversion payload block as untrusted data, but the robust
  control is **`AFFSET_READ_ONLY=true`**, which removes every mutating tool from
  the server entirely. Prefer it for reporting sessions and for any MCP client that
  auto-approves tool calls. `confirm: true` on mutating tools (including creates)
  is a model-level guard, not a security boundary.

## Supported versions

Pre-1.0: only the latest published version receives fixes.
