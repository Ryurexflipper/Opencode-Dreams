# Opencode-Dream architecture

## Purpose

Opencode-Dream turns transient AI coding sessions into durable, reusable project memory.

It does this by combining:

- event capture
- structured reflection
- cross-session consolidation
- memory application
- AGENTS export
- context reinjection into future sessions

## Main subsystems

### 1. Configuration and safety

Core file:

- `src/config.ts`

Responsibilities:

- resolve plugin options
- derive state paths
- enforce project-root confinement for configured paths
- expose preferred reflect/dream models and integration config

### 2. State layout and storage

Core files:

- `src/opendream/fs-store.ts`
- `src/opendream/dream-store.ts`

Responsibilities:

- create and summarize `.opencode-dream/`
- manage session imports
- persist reflections
- persist dream consolidations
- expose the current memory file

### 3. Live capture

Core files:

- `src/hooks/event.ts`
- `src/opendream/live-capture.ts`

Responsibilities:

- receive OpenCode events
- maintain runtime capture state
- materialize live snapshots into generic JSONL session artifacts
- handle terminal-state safety and incomplete stream degradation

### 4. Reflection pipeline

Core files:

- `src/opendream/reflection.ts`
- `src/tools/opendream-reflect-prompt.ts`
- `src/tools/opendream-reflect-run.ts`
- `src/tools/opendream-reflect-batch.ts`
- `src/tools/opendream-reflect-import-json.ts`

Responsibilities:

- validate reflection JSON shape
- render Stage 1 prompts
- run one or many reflection model calls
- import externally produced reflection JSON

### 5. Dream consolidation pipeline

Core files:

- `src/opendream/dream.ts`
- `src/tools/opendream-dream-prompt.ts`
- `src/tools/opendream-dream-run.ts`

Responsibilities:

- validate consolidation payloads
- render Stage 2 prompts from reflections + existing memory
- call the model and store dream consolidations

### 6. Memory application and export

Core files:

- `src/tools/opendream-memory-apply.ts`
- `src/opendream/agents-md.ts`
- `src/tools/opendream-export-agents.ts`

Responsibilities:

- write consolidation results into `memory/current.md`
- manage `append` and `replace` semantics
- export the active memory into a single managed AGENTS block
- preserve preview parity and marker safety

### 7. External memory integrations

Core files:

- `src/tools/opendream-mem-probe.ts`
- `src/tools/opendream-mem-sync.ts`
- `src/tools/opendream-ext-mem-sync.ts`
- `src/integrations/*.ts`

Responsibilities:

- read supported external memory systems
- normalize them into managed blocks in `memory/current.md`
- let dream-generated memory coexist with external memory

### 8. Context reinjection hooks

Core files:

- `src/hooks/compaction.ts`
- `src/hooks/env.ts`

Responsibilities:

- inject memory into session compaction context
- expose state/model information to shell tooling

## End-to-end data flow

```text
OpenCode live events or imported JSONL session files
        ↓
generic session artifacts
        ↓
reflection JSON
        ↓
dream consolidation JSON
        ↓
memory/current.md
        ↓
AGENTS.md + compaction context + shell env
```

## Why the system gets better over time

### Knowledge compounding

Each successful pass can turn experience into memory that future sessions receive earlier.

### Reliability compounding

Each discovered edge case can become:

1. a failing regression test
2. a minimal production fix
3. a permanent hardened baseline

That is why the system is both a memory pipeline and a self-improving operational loop.

## Hardened design traits

The current architecture intentionally favors:

- structured JSON errors over unexpected throws where recovery is possible
- idempotent managed blocks for memory and export surfaces
- file-first artifacts that are inspectable and testable
- deterministic behavior under malformed input
- strong boundary validation at ingest/import/run/apply/export seams

## Current maintained baseline

- hardening passes: Phases 1–8
- full repo verification baseline: `182/182` tests passing

For exact phase details, see the adversarial hardening docs.
