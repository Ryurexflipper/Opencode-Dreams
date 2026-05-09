# Opencode-Dream Mapping to OpenDream

## OpenDream concepts vs this plugin scaffold

| OpenDream concept | Upstream shape | Opencode-Dream first-pass mapping |
| --- | --- | --- |
| Trace | adapters normalize sessions into a common schema | `.opencode-dream/sessions/live/` event snapshots + `opendream_ingest_generic_jsonl` |
| Reflect | per-session LLM pass | prompt rendering + validated reflection JSON import/store under `.opencode-dream/reflections/`; automatic LLM execution not implemented yet |
| Consolidate / Dream | cross-session LLM pass updating memory | placeholder boundary; memory file and export path are scaffolded |
| Memory store | SQLite + versioned memory entries | simplified file-first staging under `.opencode-dream/memory/` |
| AGENTS.md export | managed markers inside `AGENTS.md` | implemented via `opendream_export_agents` |

## Design choice

The plugin intentionally starts with the OpenDream pieces that map cleanly to documented OpenCode APIs. It now uses the documented plugin `event` hook plus official OpenCode event types to persist best-effort session snapshots without reaching into unsupported internal runtime state.
