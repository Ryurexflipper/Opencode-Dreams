# opencode-dreams — Complete Instructions

Everything you need to know to install, configure, and operate `opencode-dreams` in one document.

---

## What this plugin does

`opencode-dreams` is an OpenCode plugin that **stops your AI coding agent from repeating the same mistakes**. After every coding session it:

1. Reflects on what happened — what went wrong, what worked, what decisions were made
2. Consolidates those reflections into durable memory (failure modes, patterns, preferences, facts)
3. Injects that memory into every future session automatically

The agent carries its learned knowledge forward. Mistakes, wrong approaches, and dead ends become `failure_mode` entries that are explicitly excluded from future sessions. Successful patterns become `workflow` and `pattern` entries the agent prefers.

---

## Requirements

- [OpenCode](https://github.com/sst/opencode) installed and running
- Node.js `>=20`
- A model configured in your OpenCode provider (see model table below)

**Tested model IDs:**

| Provider | Model ID |
|---|---|
| GitHub Copilot | `github-copilot/gpt-5.4` |
| GitHub Copilot | `github-copilot/gpt-4.5` |
| GitHub Copilot | `github-copilot/claude-sonnet-4-5` |
| Anthropic | `anthropic/claude-sonnet-4-5` |
| Anthropic | `anthropic/claude-opus-4-5` |
| OpenAI | `openai/gpt-4o` |
| OpenAI | `openai/o3` |
| AWS Bedrock | `aws/claude-sonnet-4-5` |

---

## Installation

### Step 1 — Install the package

```bash
npm install opencode-dreams
```

### Step 2 — Configure `opencode.json`

Create or edit `opencode.json` in your project root:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "github-copilot/gpt-5.4",
  "provider": {
    "github-copilot": {}
  },
  "plugin": [
    ["opencode-dreams", {
      "preferredReflectModel": "github-copilot/gpt-5.4",
      "preferredDreamModel": "github-copilot/gpt-5.4",
      "captureLiveSessions": true,
      "logLevel": "info"
    }]
  ]
}
```

If you already have plugins, append the `opencode-dreams` entry to the existing `plugin` array — do not remove other entries.

### Step 3 — Initialise the workspace (once per project)

Start an OpenCode session and tell your agent:

```
Call opendream_init to set up the workspace.
```

This creates the `.opencode-dream/` directory tree. Only needed once per project.

### Step 4 — Verify

```
Call opendream_info to confirm the plugin is loaded and show pipeline status.
```

---

## All configuration options

```jsonc
["opencode-dreams", {
  // Model for Stage 1 reflection LLM calls
  "preferredReflectModel": "github-copilot/gpt-5.4",

  // Model for Stage 2 consolidation LLM calls
  "preferredDreamModel": "github-copilot/gpt-5.4",

  // Where plugin state is stored (relative to project root)
  "projectRelativeStateDir": ".opencode-dream",

  // Auto-capture live session events as they happen
  "captureLiveSessions": true,

  // Log verbosity: "debug" | "info" | "warn" | "error"
  "logLevel": "info",

  // opencode-mem integration (optional)
  "opencodeMem": {
    "enabled": false,
    "url": "http://127.0.0.1:4747",
    "importMode": "append",   // "append" | "replace"
    "maxItemLength": 1000
  }
}]
```

---

## State layout

All plugin state lives under `.opencode-dream/` in your project root:

```text
.opencode-dream/
  sessions/
    imports/      ← JSONL sessions staged for reflection
    live/         ← auto-captured live session snapshots
    runtime/      ← transient in-progress session state
  reflections/    ← Stage 1 outputs (one JSON per session)
  dreams/         ← Stage 2 consolidation outputs
  memory/
    current.md    ← the persistent knowledge base
  docs/
    README.md     ← runtime-generated plugin summary
```

---

## All 15 tools — what they do and when to use them

### Setup and status

| Tool | When to use |
|---|---|
| `opendream_info` | Start of any session — confirm the plugin is running, see session/reflection/dream counts |
| `opendream_init` | Once per project — creates the `.opencode-dream/` layout and `AGENTS.md` markers |
| `opendream_memory_status` | Check the current memory file size and marker integrity |

### Session ingest

| Tool | When to use |
|---|---|
| `opendream_ingest_generic_jsonl` | Import a JSONL session export from another tool into the reflection queue |

### Stage 1 — Reflect

| Tool | When to use |
|---|---|
| `opendream_reflect_prompt` | Inspect the reflection prompt for a session without running the LLM |
| `opendream_reflect_import_json` | Store a reflection JSON you produced externally (e.g. from a different model) |
| `opendream_reflect_run` | Run LLM-backed reflection for a single session |
| `opendream_reflect_batch` | Run LLM-backed reflection for all un-reflected sessions at once |

### Stage 2 — Dream

| Tool | When to use |
|---|---|
| `opendream_dream_prompt` | Inspect the consolidation prompt across all reflections without running the LLM |
| `opendream_dream_run` | Run LLM-backed consolidation across all stored reflections |

### Memory and export

| Tool | When to use |
|---|---|
| `opendream_memory_apply` | Write the latest consolidation output into `memory/current.md` |
| `opendream_export_agents` | Update the managed block in `AGENTS.md` with current memory |

### External memory sync

| Tool | When to use |
|---|---|
| `opendream_mem_probe` | Preview what opencode-mem would import without writing anything |
| `opendream_mem_sync` | Pull opencode-mem memories into `memory/current.md` |
| `opendream_ext_mem_sync` | Pull from all configured external memory sources in one command |

---

## Typical workflows

### Basic — end of session

Run after each coding session to capture what was learned:

```
1. opendream_reflect_run    — reflect on the most recent session
2. opendream_dream_run      — consolidate all reflections into memory
3. opendream_memory_apply   — write consolidation into memory/current.md
4. opendream_export_agents  — update AGENTS.md
```

### Batch catch-up — multiple sessions behind

If you have several un-reflected sessions:

```
1. opendream_reflect_batch  — reflect all pending sessions at once
2. opendream_dream_run      — consolidate everything
3. opendream_memory_apply   — write to memory/current.md
4. opendream_export_agents  — update AGENTS.md
```

### Full pipeline with external memory

If you also use `opencode-mem`, `true-mem`, `simple-memory`, or `opencode-lcm`:

```
1. opendream_ext_mem_sync   — pull all external memories
2. opendream_reflect_batch  — reflect any un-processed sessions
3. opendream_dream_run      — consolidate everything
4. opendream_memory_apply   — write to memory/current.md
5. opendream_export_agents  — update AGENTS.md
```

### Quick status check

```
1. opendream_info           — see what's in the pipeline
2. opendream_memory_status  — check memory file health
```

---

## Using opencode-mem with opencode-dreams

`opencode-mem` is a separate local memory server. Enable it in your `opencode.json`:

```jsonc
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
```

Then sync during a session:

```
Call opendream_mem_sync to pull opencode-mem memories into the pipeline.
```

Or sync everything at once:

```
Call opendream_ext_mem_sync to pull from all external memory sources.
```

The `dryRun` argument lets you preview what would be written without committing:

```
Call opendream_mem_sync with dryRun=true
```

---

## Environment variables

Optional overrides — the `opencode.json` plugin config takes priority over these.

| Variable | Description |
|---|---|
| `OPENCODE_DREAM_REFLECT_MODEL` | Model for Stage 1 reflection |
| `OPENCODE_DREAM_DREAM_MODEL` | Model for Stage 2 consolidation |
| `OPENCODE_DREAM_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` |

---

## Hooks registered automatically

The plugin registers three OpenCode hooks on startup. No configuration needed.

| Hook | What it does |
|---|---|
| `event` | Captures live session events (session created/updated/deleted, tool calls) into `.opencode-dream/sessions/live/` |
| `shell.env` | Exports the resolved reflect and dream model names as environment variables |
| `experimental.session.compacting` | Injects current memory from `memory/current.md` into the compaction context so the agent sees it during compaction |

---

## How memory compounds over time

Each pass through the pipeline adds to and refines the knowledge base:

```
Session events
  → Stage 1 Reflect: per-session analysis
      → failure modes identified
      → patterns and preferences noted
      → tool use observations recorded
  → Stage 2 Dream: cross-session consolidation
      → repeated failure modes merged and strengthened
      → generalizable patterns promoted
      → task-specific hazards preserved
  → memory/current.md updated
  → AGENTS.md updated
  → memory injected into next session compaction
```

Memory entries are typed:

| Kind | Description |
|---|---|
| `failure_mode` | A mistake, wrong approach, or dead end — never repeated |
| `pattern` | A repeatable approach that works |
| `workflow` | A sequence of steps the agent has learned to follow |
| `preference` | A user or project preference to respect |
| `fact` | A factual observation about the codebase or environment |

---

## Local development

To build from source instead of using the published package:

```bash
git clone https://github.com/Ryurexflipper/Opencode-Dreams.git
cd Opencode-Dreams
npm install
npm run build
```

Then in `opencode.json`:

```jsonc
{
  "plugin": [
    ["file:///ABSOLUTE/PATH/TO/Opencode-Dreams/dist/src/index.js", {
      "preferredReflectModel": "github-copilot/gpt-5.4",
      "preferredDreamModel": "github-copilot/gpt-5.4"
    }]
  ]
}
```

Run checks:

```bash
npm run typecheck   # TypeScript type check
npm run build       # compile to dist/
npm test            # run all 182 tests
```
