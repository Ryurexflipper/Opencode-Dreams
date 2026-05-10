# opencode-dream

`opencode-dream` is an [OpenCode](https://github.com/sst/opencode) plugin that turns coding sessions into durable memory through a two-stage **Reflect → Dream** pipeline.

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
npm install opencode-dream
```

Then register the plugin in `opencode.json`:

```jsonc
{
  "plugin": [
    ["opencode-dream", {
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
