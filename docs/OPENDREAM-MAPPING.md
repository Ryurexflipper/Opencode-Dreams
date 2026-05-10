# Opencode-Dream mapping to OpenDream concepts

This document explains how the OpenDream model maps onto the concrete implementation in this repository.

## Summary

OpenDream is about turning session traces into durable, reusable memory through staged reasoning.

This plugin implements that model in a file-first, OpenCode-compatible form.

## Attribution

The Reflect → Dream backbone described here is derived from the broader OpenDream approach. `opencode-dream` is not the original OpenDream project; it is an OpenCode-focused implementation that adapts those ideas into plugin hooks, local state files, validation layers, external-memory sync, and a hardened releaseable package.

## Concept mapping

| OpenDream concept | Opencode-Dream implementation |
|---|---|
| Trace | `sessions/live/*.jsonl` from event capture, or `sessions/imports/*.jsonl` from generic JSONL ingest |
| Reflect | `opendream_reflect_prompt`, `opendream_reflect_run`, `opendream_reflect_batch`, `opendream_reflect_import_json` |
| Reflection artifact | `reflections/<session-id>.json` |
| Consolidate / Dream | `opendream_dream_prompt`, `opendream_dream_run` |
| Dream artifact | `dreams/<consolidation-id>.json` |
| Memory store | `memory/current.md` |
| Export surface | managed section inside `AGENTS.md` |
| Runtime context reinjection | compaction hook + AGENTS export + shell environment |

## Stage 0: trace acquisition

Two trace sources are supported:

### 1. Live capture

- powered by the plugin `event` hook
- transient state written under `sessions/runtime/`
- materialized snapshots written under `sessions/live/`
- hardened so terminal states reject late mutation and incomplete streams degrade safely

### 2. Imported traces

- powered by `opendream_ingest_generic_jsonl`
- source files copied into `sessions/imports/`
- invalid files are validated and rejected before state copy
- same-basename collisions are suffix-safe

## Stage 1: reflection

Stage 1 works per session.

### Implemented tools

- `opendream_reflect_prompt`
  - renders the reflection prompt only
- `opendream_reflect_run`
  - executes one reflection via model call
- `opendream_reflect_batch`
  - executes reflection for all pending sessions
- `opendream_reflect_import_json`
  - accepts external reflection JSON, validates it, and stores it

### Reflection storage

- file location: `reflections/<session-id>.json`
- schema enforced by `reflectionFromJson(...)`
- resolved session ID is authoritative over payload `session_id`

### Why this matters

Stage 1 transforms raw conversation history into structured observations that are much more reusable than a trace alone.

## Stage 2: dream consolidation

Stage 2 works across many reflections.

### Implemented tools

- `opendream_dream_prompt`
  - renders the consolidation prompt only
- `opendream_dream_run`
  - executes the consolidation via model call

### Consolidation storage

- file location: `dreams/<consolidation-id>.json`
- validated by `consolidationFromJson(...)` / `storedConsolidationFromJson(...)`

### Why this matters

Stage 2 turns many session-local lessons into fewer, more durable memory entries and synthesized themes.

## Memory layer

The active memory file is:

- `memory/current.md`

This file is intentionally human-readable and acts as the bridge between machine-produced consolidation output and future agent context.

### `opendream_memory_apply`

- `append` mode:
  - appends new dream blocks
  - replaces same `dream:<id>` block idempotently
- `replace` mode:
  - rebuilds the file from the selected consolidation only

## Export layer

`opendream_export_agents` pushes the current memory file into a single managed block in `AGENTS.md`.

This gives future agents a stable, repo-native context surface.

### Hardening guarantees

- embedded managed markers in memory content are neutralized
- malformed existing marker topology is handled deterministically
- dry-run preview follows the same block-detection logic as real export

## External memory sources

This plugin also acts as a unifying layer for existing memory plugins.

Implemented integrations:

- `opencode-mem`
- `true-mem`
- `simple-memory`
- `opencode-lcm`

These write tagged source blocks into `memory/current.md`, where they can coexist with dream-generated memory.

## How the pieces work together

```text
OpenCode events / imported session files
        ↓
Generic JSONL session artifacts
        ↓
Stage 1 reflection JSON
        ↓
Stage 2 dream consolidation JSON
        ↓
memory/current.md
        ↓
AGENTS.md + compaction hook + shell.env
```

## Self-improvement model

The plugin improves future work in two feedback loops:

### Knowledge loop

session traces → reflections → consolidations → memory → future session context

### Reliability loop

observed bugs / adversarial seams → regression tests → minimal fixes → hardened baseline

As of the current baseline, Phases 1–8 have turned the original scaffold into a tested, structured, self-reinforcing memory system.
