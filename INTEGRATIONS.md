# Memory Integration Compatibility

This file documents how `opencode-dream` co-exists with and enhances other memory storage systems used in opencode.

---

## Supported Integrations

### ✅ opencode-mem (`http://127.0.0.1:4747`)

**What it is**: A local HTTP server that stores persistent memory items across sessions.
npm package: [`opencode-mem`](https://www.npmjs.com/package/opencode-mem)

**How it works with opencode-dream**:
- `opendream_mem_probe` — checks if the server is running and previews stored items
- `opendream_mem_sync` — fetches all items and injects them into `memory/current.md` under a tagged block (`<!-- opencode-mem:sync ... -->`)
- The block is cleanly replaceable on every sync — no duplicates accumulate

**Enable in `opencode.json`**:
```json
{
  "file:///path/to/opencode-dream/src/index.ts": {
    "preferredReflectModel": "github-copilot/gpt-4o",
    "preferredDreamModel": "github-copilot/gpt-4o",
    "opencodeMem": {
      "enabled": true,
      "url": "http://127.0.0.1:4747",
      "importMode": "append",
      "maxItemLength": 1000
    }
  }
}
```

**Config options**:

| Option | Default | Description |
|---|---|---|
| `enabled` | `false` | Must be `true` to allow sync |
| `url` | `http://127.0.0.1:4747` | Base URL of opencode-mem server |
| `importMode` | `append` | `append` replaces existing sync block; `replace` rewrites entire memory file |
| `maxItemLength` | `1000` | Truncates long memory items to this character limit |

**Recommended workflow**:
```
1. opendream_mem_probe          → verify server is running, preview items
2. opendream_mem_sync           → inject into memory/current.md
3. opendream_reflect_batch      → Stage 1: reflect on session files
4. opendream_dream_run          → Stage 2: consolidate into dream entries
5. opendream_memory_apply       → merge dream entries into memory/current.md
6. opendream_export_agents      → push to AGENTS.md
```

---

### ✅ true-mem (`~/.true-mem/memory.db`)

**What it is**: Persistent semantic memory stored in SQLite, with strength scoring and classification.
npm package: [`true-mem`](https://github.com/rizal72/true-mem) (171 ⭐)

**How it works with opencode-dream**:
- `opendream_ext_mem_sync` with `sources: ["true-mem"]` reads active memory units
- Reads: `classification`, `summary`, `strength`, `project_scope`, `store` (STM/LTM)
- Groups output by classification (preference, learning, decision, etc.)
- Requires `better-sqlite3` or `sql.js` as a peer dependency

**Classifications**: `constraint` | `preference` | `learning` | `procedural` | `decision` | `semantic` | `episodic`

**Config**: Use `trueMemDbPath` argument to override the default `~/.true-mem/memory.db`.

---

### ✅ simple-memory (`.opencode/memory/*.logfmt`)

**What it is**: Lightweight logfmt-based memory store — one file per day in `.opencode/memory/`.
npm package: [`@knikolov/opencode-plugin-simple-memory`](https://www.npmjs.com/package/@knikolov/opencode-plugin-simple-memory) (95 ⭐)

**How it works with opencode-dream**:
- `opendream_ext_mem_sync` with `sources: ["simple-memory"]` reads all `.logfmt` files
- Parses `ts=`, `type=`, `scope=`, `content=` fields per line
- Groups output by type (decision, learning, preference, pattern, context, blocker)
- No native dependencies — pure file reads

**Types**: `decision` | `learning` | `preference` | `blocker` | `context` | `pattern`

**Config**: Use `simpleMemoryDir` argument to override the default `.opencode/memory/` location.

---

### ✅ opencode-lcm (`.lcm/lcm.db`)

**What it is**: Long-context memory system with SQLite FTS5, storing session summaries and artifacts.
npm package: [`opencode-lcm`](https://github.com/Plutarch01/opencode-lcm) (42 ⭐)

**How it works with opencode-dream**:
- `opendream_ext_mem_sync` with `sources: ["opencode-lcm"]` reads `summaries` and `artifacts` tables
- Session summaries (up to 200 most recent) + artifacts (up to 100 most recent)
- Requires `better-sqlite3` or `sql.js` as a peer dependency

**Tables**: `messages`, `summaries`, `artifacts`

**Config**: Use `lcmDbPath` argument to override the default `.lcm/lcm.db` location.

---

## Planned / Possible Integrations

### 🔜 opencode built-in memory (`memory` tool)
- opencode's native `memory` tool stores key-value memories per project
- Location: varies by config, often `~/.config/opencode/memory/`
- Future: `opendream_mem_sync` could also read from this path directly

### 🔜 AGENTS.md / CLAUDE.md file memory
- Convention-based: agents read a file at project root for context
- Already supported via `opendream_export_agents`

### 🔜 `.opencode/context/` directory
- Some setups use `.opencode/context/*.md` files for persistent context injection
- Future: opencode-dream could watch and append to these files

### 🔜 Custom JSONL stores
- Already supported via `opendream_ingest_generic_jsonl` for any JSONL-formatted memory export

### 🔜 Other HTTP memory servers
- Any server that exposes `GET /api/memories → { data: { items: [] } }` is compatible with the opencode-mem integration
- The `url` config option allows pointing to any compatible server

---

## Memory Layering Model

opencode-dream treats memory as layered — each source feeds into `memory/current.md`:

```
┌────────────────────────────────────────────────────────────────┐
│                      memory/current.md                         │  ← single unified file read by agents
├──────────────┬──────────────┬────────────────┬─────────────────┤
│  opencode-   │  true-mem    │  simple-memory │  opencode-lcm   │
│  mem sync    │  sync block  │  sync block    │  sync block     │
│  block       │  (SQLite)    │  (logfmt)      │  (SQLite FTS5)  │
├──────────────┴──────────────┴────────────────┴─────────────────┤
│              opencode-dream consolidations                      │
│              (from reflect + dream run)                         │
└────────────────────────────────────────────────────────────────┘
```

Each block is tagged so they can be independently replaced without clobbering each other:
- `<!-- opencode-mem:sync ... --> ... <!-- /opencode-mem:sync -->`
- `<!-- true-mem:sync ... --> ... <!-- /true-mem:sync -->`
- `<!-- simple-memory:sync ... --> ... <!-- /simple-memory:sync -->`
- `<!-- opencode-lcm:sync ... --> ... <!-- /opencode-lcm:sync -->`
- `<!-- dream:<id> --> ... <!-- /dream:<id> -->`

**Quick sync all sources at once:**
```
opendream_ext_mem_sync  (sources: ["opencode-mem", "true-mem", "simple-memory", "opencode-lcm"])
```

**Or sync a specific source only:**
```
opendream_ext_mem_sync  (sources: ["simple-memory"])
```

---

## Integration Detection

Run `opendream_info` to see:
- Whether `opencodeMem.enabled` is set
- The configured URL
- Whether the server is currently reachable

Run `opendream_mem_probe` to test opencode-mem connectivity and preview items without writing anything.

Run `opendream_ext_mem_sync` with `dryRun: true` to preview what all sources would produce without writing to disk.

---

## Adding a New Integration

To add support for a new memory storage backend:

1. Create `src/integrations/<name>.ts` — HTTP client or file reader, returns `{ ok, items }`
2. Create `src/tools/opendream-<name>-sync.ts` — tool that calls the integration and writes to `memory/current.md`
3. Register in `src/index.ts`
4. Add config options to `DreamPluginOptions` in `src/config.ts`
5. Document here

The contract is simple: any source that can produce a list of `{ id, content }` items is compatible.
