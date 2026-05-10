# External memory integrations

`opencode-dream` can merge external memory systems into the same `memory/current.md` file used by the Dream pipeline.

This gives one unified memory surface for:

- external memory plugins
- opencode-dream dream consolidations
- AGENTS export
- compaction-time memory injection

## Supported integrations

### `opencode-mem`

**Type:** HTTP service

Implemented tools:

- `opendream_mem_probe`
- `opendream_mem_sync`
- `opendream_ext_mem_sync`

Behavior:

- fetches memory items from a compatible HTTP endpoint
- writes a managed `opencode-mem:sync` block into `memory/current.md`
- supports `append` and `replace`
- respects per-item truncation limits

### `true-mem`

**Type:** SQLite

Implemented via:

- `opendream_ext_mem_sync` with `sources: ["true-mem"]`

Behavior:

- reads active true-mem units
- renders them into a tagged sync block
- keeps that block replaceable without touching other sources

### `simple-memory`

**Type:** logfmt file store

Implemented via:

- `opendream_ext_mem_sync` with `sources: ["simple-memory"]`

Behavior:

- reads `.logfmt` memory entries
- groups and renders them into a tagged sync block

### `opencode-lcm`

**Type:** SQLite / long-context store

Implemented via:

- `opendream_ext_mem_sync` with `sources: ["opencode-lcm"]`

Behavior:

- reads summaries and artifacts
- renders them into a tagged sync block

## Unified block model

Each source owns its own block in `memory/current.md`:

```text
<!-- opencode-mem:sync ... --> ... <!-- /opencode-mem:sync -->
<!-- true-mem:sync ... --> ... <!-- /true-mem:sync -->
<!-- simple-memory:sync ... --> ... <!-- /simple-memory:sync -->
<!-- opencode-lcm:sync ... --> ... <!-- /opencode-lcm:sync -->
<!-- dream:<id> --> ... <!-- /dream:<id> -->
```

This means:

- one source can be refreshed without overwriting the others
- repeated syncs are idempotent per source
- dream-generated memory can coexist with imported external memory

## How external memory and dream memory work together

```text
external memory plugins ─┐
                         ├─> memory/current.md ─> AGENTS.md
dream consolidations  ───┘
```

That makes `memory/current.md` the central merge surface.

## Recommended usage

### Probe first

Use:

- `opendream_mem_probe`

to check connectivity and preview what `opencode-mem` would contribute.

### Sync one source

```text
opendream_ext_mem_sync  { "sources": ["simple-memory"] }
```

### Sync multiple sources

```text
opendream_ext_mem_sync  {
  "sources": ["opencode-mem", "true-mem", "simple-memory", "opencode-lcm"]
}
```

### Preview only

```text
opendream_ext_mem_sync  { "dryRun": true }
```

## Configuration notes

### `opencode-mem`

Configured in plugin options:

```jsonc
{
  "opencodeMem": {
    "enabled": true,
    "url": "http://127.0.0.1:4747",
    "importMode": "append",
    "maxItemLength": 1000
  }
}
```

### SQLite-backed sources

`true-mem` and `opencode-lcm` require a SQLite backend at runtime.

Supported peer/runtime options:

- `better-sqlite3`
- `sql.js`

If neither is present, the tool returns a clear structured error instead of crashing.

## Safety guarantees

The integration renderers were hardened specifically to avoid managed-marker corruption.

Protected behaviors include:

- imported content cannot break the managed block structure by injecting raw markers
- repeated non-dry-run syncs remain stable
- mixed-success unified syncs preserve successful source blocks
- dry-run mode previews merged content without writing

## What is not currently claimed

This document only describes integrations that are actually implemented in the codebase today.

Additional integrations can be added later, but they are not treated as active features until tooling, tests, and docs all exist.
