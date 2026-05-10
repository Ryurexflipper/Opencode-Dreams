# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-10

### Added
- initial OpenCode plugin packaging and filesystem layout
- generic JSONL session ingest
- event-driven live session capture
- Stage 1 reflection prompt rendering and JSON import
- Stage 1 LLM-backed reflection execution
- Stage 2 prompt rendering and LLM-backed consolidation execution
- memory application into `memory/current.md`
- managed `AGENTS.md` export
- compaction-context memory injection
- shell environment hook for state/model paths
- external memory synchronization support
- full staged Dream pipeline documentation covering setup, architecture, integrations, and self-improvement flow
- `tests/phase1-hardening.test.ts` through `tests/phase8-hardening.test.ts` (182 tests total)
- direct regression coverage for:
  - config path confinement
  - managed-marker neutralization
  - ingest validation and import collisions
  - live-capture terminal-state safety and multipart correctness
  - reflection input ambiguity and malformed stored reflection handling
  - invalid parsed consolidation handling
  - reflect-import tool-boundary structured errors
  - repeated memory/apply/export cycle stability

### Changed
- README and supporting docs reflect the current implemented system
- hardening baseline documented through optional Phase 8
- verification baseline: 182/182 tests passing

### Fixed
- tool boundaries return structured JSON errors for malformed reflection/session/consolidation inputs in key recovery paths
- AGENTS export and external-memory rendering resist marker corruption and malformed topology
- live capture rejects late post-terminal mutations and degrades incomplete streams safely
- memory apply and export flows are stable across repeated append/replace cycles
