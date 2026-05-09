# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `opendream_reflect_batch` — batch Stage 1 reflection across all unprocessed sessions
- `opendream_dream_run` — Stage 2 LLM-backed memory consolidation from all reflections
- `opendream_dream_prompt` — dry-run Stage 2 consolidation prompt rendering
- `opendream_memory_apply` — apply dream consolidation entries to `memory/current.md`
- Improved `opendream_info` with pipeline status (pending reflections, dream count, full tool inventory)
- `src/opendream/dream.ts` — `DreamConsolidation` type, prompt renderer, JSON validator
- `src/opendream/dream-store.ts` — consolidation file I/O helpers

## [0.1.0] - 2026-05-09

### Added
- Plugin scaffold with full filesystem layout management
- Generic JSONL session ingest (`opendream_ingest_generic_jsonl`)
- Event-driven live session capture via `event` hook
- Stage 1 reflection prompt rendering (`opendream_reflect_prompt`)
- Validated reflection JSON import (`opendream_reflect_import_json`)
- Automatic LLM-backed Stage 1 reflection (`opendream_reflect_run`)
- AGENTS.md managed export (`opendream_export_agents`)
- Compaction hook — injects `memory/current.md` into session compaction
- Shell env hook — exposes `OPENCODE_DREAM_ROOT` and friends
- Vitest test suite (6 tests)
