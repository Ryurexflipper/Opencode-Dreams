# opencode-dreams

`opencode-dreams` is an [OpenCode](https://github.com/sst/opencode) plugin that turns coding sessions into durable memory through a two-stage **Reflect → Dream** pipeline.

It is heavily inspired by the broader **OpenDream** model and ecosystem. This repository adapts that backbone into a concrete OpenCode plugin implementation with its own hardening, packaging, integration, and operational layers. Credit for the underlying Reflect/Dream conceptual backbone belongs to the original OpenDream work and maintainers.

It combines:
- live session capture and imported trace ingestion
- per-session reflection generation
- cross-session consolidation into durable memory
- export into `AGENTS.md`
- external memory sync from popular OpenCode memory plugins
- a regression-hardened baseline validated through adversarial testing phases

```text
Live session / imported trace
  -> Stage 1: Reflect
  -> Stage 2: Dream
  -> memory/current.md
  -> AGENTS.md
```

## Current baseline

- End-to-end pipeline is implemented
- Hardening baseline spans Phases 1–8
- Latest verified baseline: **182/182 tests passing**

See also:
- `docs/ARCHITECTURE.md`
- `docs/INSTALL.md`
- `docs/OPENDREAM-MAPPING.md`
- `docs/adversarial-hardening-status.md`

## Installation

```bash
npm install opencode-dreams
```

Then register the plugin in `opencode.json`:

```jsonc
{
  "plugin": [
    ["opencode-dreams", {
      "preferredReflectModel": "github-copilot/gpt-5.4",
      "preferredDreamModel": "github-copilot/gpt-5.4"
    }]
  ]
}
```

## What it does

### Capture and ingest
- auto-captures live sessions into `.opencode-dream/sessions/live/`
- stores transient capture state in `.opencode-dream/sessions/runtime/`
- imports external traces into `.opencode-dream/sessions/imports/`

### Stage 1: Reflect
- renders reflection prompts
- runs LLM-backed reflection for one session or in batch
- imports externally generated reflection JSON
- stores validated reflections in `.opencode-dream/reflections/`

### Stage 2: Dream
- renders consolidation prompts
- runs LLM-backed consolidation across stored reflections
- stores validated dream outputs in `.opencode-dream/dreams/`

### Memory and export
- applies consolidation entries into `.opencode-dream/memory/current.md`
- exports current memory into one managed `AGENTS.md` block
- injects consolidated memory into session compaction context

### External memory sync
- supports:
  - `opencode-mem`
  - `true-mem`
  - `simple-memory`
  - `opencode-lcm`
- merges each source into tagged blocks inside `memory/current.md`

## Hooks

The plugin registers three hooks:
- `event` — live session capture
- `shell.env` — exports resolved state/model env vars
- `experimental.session.compacting` — injects current memory into compaction

## State layout

```text
.opencode-dream/
  sessions/
    imports/
    live/
    runtime/
  reflections/
  dreams/
  memory/
    current.md
  docs/
    README.md
```

## Available tools

The plugin currently exposes **15 tools**:

- setup/status
  - `opendream_info`
  - `opendream_init`
  - `opendream_memory_status`
- session ingest
  - `opendream_ingest_generic_jsonl`
- Stage 1 reflection
  - `opendream_reflect_prompt`
  - `opendream_reflect_import_json`
  - `opendream_reflect_run`
  - `opendream_reflect_batch`
- Stage 2 dream
  - `opendream_dream_prompt`
  - `opendream_dream_run`
- memory/export
  - `opendream_memory_apply`
  - `opendream_export_agents`
- external memory
  - `opendream_mem_probe`
  - `opendream_mem_sync`
  - `opendream_ext_mem_sync`

## Usage guide

### Typical session workflow

Run these tools inside an OpenCode session (tell your agent to call them by name):

```
1. opendream_info           — check plugin status and pipeline state
2. opendream_reflect_run    — reflect on the most recent session
3. opendream_dream_run      — consolidate all reflections into memory
4. opendream_memory_apply   — write consolidation into memory/current.md
5. opendream_export_agents  — update AGENTS.md with current memory
```

After a few sessions, memory compounds automatically — each Dream pass builds on prior ones.

---

### Tool reference

#### Setup and status

| Tool | What it does |
|---|---|
| `opendream_info` | Shows plugin config, tool inventory, and current pipeline state (session/reflection/dream counts) |
| `opendream_init` | Initialises the `.opencode-dreams/` workspace layout and optional `AGENTS.md` markers |
| `opendream_memory_status` | Shows the current memory file path, size, and whether markers are intact |

#### Session ingest

| Tool | What it does |
|---|---|
| `opendream_ingest_generic_jsonl` | Validates and stages a JSONL session export into the import queue for reflection |

#### Stage 1 — Reflect

| Tool | What it does |
|---|---|
| `opendream_reflect_prompt` | Renders the reflection prompt for a stored session (for manual inspection or external LLM use) |
| `opendream_reflect_import_json` | Validates and stores a reflection JSON you produced externally |
| `opendream_reflect_run` | Runs LLM-backed reflection for a single session |
| `opendream_reflect_batch` | Runs LLM-backed reflection for all un-reflected sessions in one pass |

#### Stage 2 — Dream

| Tool | What it does |
|---|---|
| `opendream_dream_prompt` | Renders the consolidation prompt across all stored reflections (for manual inspection) |
| `opendream_dream_run` | Runs LLM-backed consolidation and saves the dream output |

#### Memory and export

| Tool | What it does |
|---|---|
| `opendream_memory_apply` | Applies the latest dream consolidation into `memory/current.md` |
| `opendream_export_agents` | Writes current memory into the managed block in `AGENTS.md` |

#### External memory sync

| Tool | What it does |
|---|---|
| `opendream_mem_probe` | Reads raw items from the opencode-mem server without writing anything |
| `opendream_mem_sync` | Pulls opencode-mem memories into `memory/current.md` |
| `opendream_ext_mem_sync` | Pulls from **all** configured external memory sources in one command |

---

### Using opencode-mem with opencode-dreams

`opencode-mem` is a separate memory server that stores memories independently of sessions. `opencode-dreams` can pull those memories into its own pipeline so agents always have both kinds of context.

**Step 1 — Enable opencode-mem in your `opencode.json`:**

```jsonc
{
  "plugin": [
    ["opencode-dreams", {
      "preferredReflectModel": "github-copilot/gpt-5.4",
      "preferredDreamModel": "github-copilot/gpt-5.4",
      "opencodeMem": {
        "enabled": true,
        "url": "http://127.0.0.1:4747",
        "importMode": "append",
        "maxItemLength": 1000
      }
    }]
  ]
}
```

| Option | Default | Description |
|---|---|---|
| `enabled` | `false` | Must be `true` to activate the integration |
| `url` | `http://127.0.0.1:4747` | Base URL of your running opencode-mem server |
| `importMode` | `"append"` | `"append"` replaces the existing block or adds it; `"replace"` rebuilds the whole memory file |
| `maxItemLength` | `1000` | Truncates long memory items to this character limit |

**Step 2 — Sync memories during a session:**

Tell your agent:
```
Call opendream_mem_sync to pull my opencode-mem memories into the pipeline.
```

Or use the unified command to sync all sources at once:
```
Call opendream_ext_mem_sync to pull from all external memory sources.
```

You can also pass arguments:
```
Call opendream_mem_sync with url="http://127.0.0.1:4747" and dryRun=true
```

**Step 3 — After sync, export to AGENTS.md:**
```
Call opendream_export_agents to write the updated memory into AGENTS.md.
```

**Recommended session start sequence with opencode-mem:**
```
1. opendream_ext_mem_sync   — pull latest external memories
2. opendream_reflect_batch  — reflect any un-processed sessions
3. opendream_dream_run      — consolidate everything
4. opendream_memory_apply   — persist to memory/current.md
5. opendream_export_agents  — update AGENTS.md
```

---

### Environment variables

These can be set in `.env` or your shell — they are optional overrides. The plugin config in `opencode.json` takes priority.

| Variable | Description |
|---|---|
| `OPENCODE_DREAM_REFLECT_MODEL` | Model to use for Stage 1 reflection (e.g. `github-copilot/gpt-5.4`) |
| `OPENCODE_DREAM_DREAM_MODEL` | Model to use for Stage 2 consolidation |
| `OPENCODE_DREAM_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` (default: `info`) |

## How it improves itself over time

The system improves in two ways:

1. **Knowledge compounding**
   - sessions become reflections
   - reflections become consolidations
   - consolidations become durable memory
   - memory is reinjected into future sessions and exports

2. **Reliability compounding**
   - adversarial hardening Phases 1–8 added direct regression coverage for path safety, marker handling, live-capture integrity, reflection/dream validation, and memory/export stability
   - recoverable tool-boundary failures now return structured JSON instead of crashing in key paths

## Release quality

- Node.js >= 20
- ESM-only package
- `npm run typecheck`
- `npm run build`
- `npm test`

Current maintained verification baseline: **182/182 tests passing**.

## Documentation map

- `docs/INSTALL.md` — install and first-run flow
- `docs/ARCHITECTURE.md` — subsystem/data-flow overview
- `docs/OPENDREAM-MAPPING.md` — OpenDream concept mapping
- `INTEGRATIONS.md` — external memory sources and merge model
- `docs/adversarial-hardening-status.md` — hardening history and current baseline

## Attribution

- Conceptual backbone: the broader **OpenDream** reflection/consolidation model
- This repository: an OpenCode-specific implementation, hardening pass, and releaseable plugin built on top of that conceptual foundation

## License

MIT
