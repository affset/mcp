# Contributing

Thanks for your interest in the affset MCP server.

## Development

```bash
npm install          # installs deps and builds via the prepare script
npm run type-check   # tsc --noEmit
npm run lint         # eslint src
npm run format       # prettier --write .
npm run build        # compile to dist/
npm test             # build + node --test over dist/**/*.test.js
npm run check-all    # lint + format:check + type-check + test — run before opening a PR
npm run dev          # watch mode
```

Requires Node 18+.

## Conventions

- **TypeScript, strict mode.** No `any` escapes; keep the build clean under the
  existing `tsconfig.json`.
- **One tool per file** under `src/tools/`. A tool module exports its handler, its
  Zod `inputSchema`, and an uppercase `*_DESCRIPTION` string. Register it in
  `src/server.ts` with the right `annotations` — in particular, `readOnlyHint: true`
  is what keeps a tool available under `AFFSET_READ_ONLY`, so set it honestly.
- **Mutations follow show → confirm → apply.** Anything that writes defaults to a
  dry run and only applies with `confirm: true`.
- **stdout is the JSON-RPC channel.** All diagnostics go to `stderr` — never
  `console.log`.
- **Treat tool output as model context.** Any field that can carry values from
  clicks or conversion pixels is attacker-influenced; run it through the helpers in
  `src/lib/format.ts` (`mdCell`, `capUntrusted`) rather than interpolating raw.
- **Tests are colocated** as `*.test.ts` next to the code and run against compiled
  output. Add or update them for behavior changes.

## Pull requests

1. Branch off `main`.
2. Keep the change focused; update the README tool table and `CHANGELOG.md` when
   behavior changes.
3. Ensure `npm run check-all` passes.
4. Never commit secrets. Credentials belong in the environment; `.env` is
   gitignored.

## Security

Do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
