# Contributing to Opencode-Dream

Thank you for your interest in contributing! This document describes the development workflow and standards.

## Prerequisites

- Node.js 22+ (LTS)
- npm 10+
- TypeScript knowledge

## Setup

```bash
git clone https://github.com/<your-org>/opencode-dream.git
cd opencode-dream
npm install
```

## Development workflow

```bash
# Type-check only (fast)
npm run typecheck

# Build to dist/
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## Project structure

```
src/
  index.ts              Plugin entry point — registers all tools and hooks
  config.ts             Config resolution
  env.ts                Environment variable helpers
  logger.ts             Structured logging to opencode app log
  hooks/                Hook implementations (compaction, env, event)
  opendream/            Core domain logic (reflection, dream, fs-store, etc.)
  tools/                One file per tool
tests/
  opencode-dream-smoke.test.ts   Vitest smoke tests
```

## Adding a new tool

1. Create `src/tools/opendream-<name>.ts` following the existing tool pattern
2. Export a `createOpencodeDream<Name>Tool(config, ...)` factory
3. Import and register it in `src/index.ts`
4. Add smoke tests for error paths and key behaviours in `tests/`

## Code standards

- ESM only — all imports use `.js` extensions
- No `any` types — use `unknown` and narrow explicitly
- Errors: return structured JSON strings for recoverable failures; throw for fatal/unexpected errors
- All LLM calls go through `client.session.create()` + `client.session.prompt()` — no direct API calls
- `tool.schema` is Zod — use `.describe()` on every arg

## Tests

Tests use Vitest. Do not make live LLM calls in tests — stub the client or test error/validation paths only.

```bash
npm test
```

## Pull requests

- One PR per logical change
- Include a summary in the PR description
- All CI checks must pass (typecheck + build + test)
- Update `CHANGELOG.md` under `[Unreleased]`

## License

MIT — see [LICENSE](LICENSE).
