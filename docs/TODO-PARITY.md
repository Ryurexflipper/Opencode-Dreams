# OpenDream parity status and future opportunities

This file no longer tracks missing basics from an early scaffold. Those items have now been implemented.

## Implemented parity-relevant capabilities

- live session capture into normalized JSONL snapshots
- generic JSONL session ingest
- Stage 1 prompt rendering
- Stage 1 LLM execution for single sessions
- Stage 1 batch reflection across pending sessions
- validated reflection JSON import
- Stage 2 prompt rendering
- Stage 2 LLM-backed consolidation
- validated consolidation storage
- memory apply in `append` and `replace` modes
- AGENTS managed export
- compaction-context memory injection
- shell environment exposure for state/model paths
- external memory synchronization from four supported sources

## Hardening achieved

The system is not just implemented; it is now regression-protected through the adversarial hardening passes documented in:

- `docs/adversarial-hardening-plan.md`
- `docs/adversarial-hardening-status.md`

Coverage includes:

- config path confinement
- marker injection safety
- ingest validation and import collisions
- live-capture terminal-state correctness
- reflection/dream structured error handling
- memory/apply/export stability across repeated cycles

## Remaining parity-adjacent opportunities

These are no longer missing core features. They are optional refinement areas.

### 1. Evaluation harness interoperability

- port or interoperate with upstream-style evals if a stable external benchmark becomes useful

### 2. Review / approval workflows

- add an explicit human review step before applying or exporting some memory updates if a stricter governance mode is desired

### 3. Richer analysis surfaces

- add metrics or dashboards around reflection quality, consolidation churn, or memory usefulness over time

### 4. New feature-driven tests

- future test growth should be driven by:
  - newly observed bugs
  - API changes
  - new feature surfaces
  - new external integration shapes

## Current guidance

Treat the current system as a maintained, working implementation rather than a scaffold awaiting parity.
