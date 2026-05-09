# Opencode-Dream

**Opencode-Dream** is an [OpenCode](https://github.com/sst/opencode) plugin that implements the Dream pipeline — a two-stage reflection-and-consolidation system for turning live AI coding sessions into durable, reusable memory.

## Overview

```
Live session  →  Stage 1: Reflection  →  Stage 2: Dream  →  memory/current.md  →  AGENTS.md
(JSONL trace)    (per-session JSON)       (consolidated)      (apply entries)       (export)
```

The plugin runs inside OpenCode as a first-class plugin and provides:

- **Live capture** — event-driven snapshot of every session as it runs
- **Stage 1 Reflection** — LLM-backed per-session analysis into structured JSON
- **Stage 2 Dream** — cross-session memory synthesis into a dream consolidation
- **Memory apply** — writes dream entries into `memory/current.md`
- **AGENTS.md export** — injects consolidated memory into a managed section of `AGENTS.md`

---

## Installation

```jsonc
// opencode.json (or opencode.jsonc)
{
  "plugin": [
    ["file:///path/to/opencode-dream/src/index.ts", {
      "preferredReflectModel": "github-copilot/gpt-4.1",
      "preferredDreamModel": "github-copilot/gpt-4.1"
    }]
  ]
}
```

### Plugin options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `projectRelativeStateDir` | `string` | `.opencode-dream` | Where state is stored, relative to project root |
| `memoryFile` | `string` | `<stateDir>/memory/current.md` | Memory source file for AGENTS.md export |
| `agentsFile` | `string` | `AGENTS.md` | Target AGENTS.md path |
| `captureLiveSessions` | `boolean` | `true` | Whether to capture live session events |
| `preferredReflectModel` | `string` | — | Model for Stage 1 reflection (`providerID/modelID`) |
| `preferredDreamModel` | `string` | — | Model for Stage 2 consolidation (`providerID/modelID`) |
| `logLevel` | `string` | `info` | One of `debug`, `info`, `warn`, `error` |

### Environment variables

| Variable | Description |
|----------|-------------|
| `OPENCODE_DREAM_REFLECT_MODEL` | Fallback reflect model |
| `OPENCODE_DREAM_DREAM_MODEL` | Fallback dream model |
| `OPENCODE_DREAM_API_KEY` | Optional API key for future direct model calls |

---

## State directory layout

```
.opencode-dream/
  memory/
    current.md          ← edit this; it is what gets exported to AGENTS.md
  sessions/
    imports/            ← manually imported .jsonl traces
    live/               ← auto-captured live session snapshots
    runtime/            ← transient capture state (safe to delete)
  reflections/          ← Stage 1 reflection JSON files (one per session)
  dreams/               ← Stage 2 dream consolidation files
  docs/
    README.md           ← auto-generated layout documentation
```

---

## Available tools

### Setup & Status

| Tool | Description |
|------|-------------|
| `opendream_init` | Creates the `.opencode-dream` directory layout |
| `opendream_info` | Shows config, pipeline status, and full tool inventory |
| `opendream_memory_status` | Summarises captured sessions, reflections, and memory file |

### Session Ingest

| Tool | Description |
|------|-------------|
| `opendream_ingest_generic_jsonl` | Imports a JSONL session file into `sessions/imports/` |

### Stage 1: Reflection

| Tool | Description |
|------|-------------|
| `opendream_reflect_prompt` | Dry-run: renders the reflection prompt without calling a model |
| `opendream_reflect_import_json` | Validates and stores a reflection JSON you provide externally |
| `opendream_reflect_run` | Runs Stage 1 on a single session file via LLM |
| `opendream_reflect_batch` | Batch Stage 1: reflects on all sessions without reflections yet |

### Stage 2: Dream Consolidation

| Tool | Description |
|------|-------------|
| `opendream_dream_prompt` | Dry-run: renders the consolidation prompt without calling a model |
| `opendream_dream_run` | Runs Stage 2: synthesizes all reflections into a dream consolidation via LLM |

### Memory & Export

| Tool | Description |
|------|-------------|
| `opendream_memory_apply` | Applies dream consolidation entries into `memory/current.md` |
| `opendream_export_agents` | Exports `memory/current.md` into the `AGENTS.md` managed section |

---

## Recommended workflow

```
1. opendream_init
   → Creates .opencode-dream/ layout

2. [Sessions run automatically]
   → Live capture saves snapshots to sessions/live/

3. opendream_reflect_batch
   → Runs Stage 1 on all unprocessed sessions (or use opendream_reflect_run per-file)

4. opendream_dream_run
   → Stage 2: synthesizes all reflections → saves to dreams/

5. opendream_memory_apply
   → Applies dream entries into memory/current.md

6. opendream_export_agents
   → Injects memory into AGENTS.md between managed markers

7. Commit AGENTS.md
   → Future sessions start with consolidated context
```

---

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

Tests use [Vitest](https://vitest.dev/) and do not require a live OpenCode instance.

### Adding a new tool

1. Create `src/tools/opendream-<name>.ts` with a `createOpencodeDream<Name>Tool` factory
2. Register it in `src/index.ts`
3. Add smoke tests in `tests/opencode-dream-smoke.test.ts`

---

## Architecture notes

- Plugin is ESM-only (`"type": "module"`)
- Peer deps: `@opencode-ai/plugin ^1.14.41`, `@opencode-ai/sdk ^1.14.41`
- All tools follow the `tool({ description, args, execute })` pattern from `@opencode-ai/plugin`
- `tool.schema` is Zod — all args use `.describe()`
- LLM calls go through `client.session.create()` + `client.session.prompt()` — no direct API calls
- Ephemeral sessions are always deleted in a `finally` block
- Error paths return structured JSON strings (not throws) for recoverable failures

---

## License

MIT
