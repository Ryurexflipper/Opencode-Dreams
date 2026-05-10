# Adversarial Hardening Status

## Repository guardrails

- Work remains contained to `/mnt/g/Opencode-Dream/Opencode-Dream`
- No files were deleted
- No files outside the repository were modified

## Completed in Phase 1

### Tests added

- `tests/phase1-hardening.test.ts`
  - config path confinement rejects escaping paths
  - managed-marker neutralization for opencode-mem/simple-memory/true-mem/opencode-lcm output
  - AGENTS export neutralizes embedded dream markers
  - repeated non-dry-run memory apply remains stable for adversarial IDs

### Production fixes added

- `src/config.ts`
  - rejects resolved paths that escape the project root
- `src/opendream/agents-md.ts`
  - neutralizes embedded Opencode-Dream markers inside managed block body content
- `src/integrations/opencode-mem.ts`
  - neutralizes raw HTML-comment markers in imported content
- `src/integrations/simple-memory.ts`
  - neutralizes raw HTML-comment markers in imported content
- `src/integrations/true-mem.ts`
  - neutralizes raw HTML-comment markers in imported content
- `src/integrations/opencode-lcm.ts`
  - neutralizes raw HTML-comment markers in imported content

## Completed in Phase 2

### Tests added

- `tests/phase2-hardening.test.ts`
  - ext-mem non-dry-run append mode stays idempotent across repeated writes
  - mixed-success ext-mem runs preserve successful source blocks in non-dry-run mode
  - invalid generic JSONL inputs are not copied into state when validation fails
  - same-basename imports get unique filenames instead of overwriting prior imports

### Production fixes added

- `src/tools/opendream-ingest-generic-jsonl.ts`
  - copies into state only when validation has at least one valid line and zero invalid lines
  - returns an explanatory note when copy is skipped after validation failure
- `src/opendream/fs-store.ts`
  - suffixes colliding imported basenames (`-1`, `-2`, ...) instead of overwriting existing files

## Completed in Phase 3

### Tests added

- `tests/phase3-hardening.test.ts`
  - late `message.updated` and `message.part.updated` events are ignored after `session.error`
  - late part updates are ignored after `session.deleted`
  - interleaved tool/reasoning/text updates preserve original order while same-part updates replace content
  - unresolved parts degrade into explicit `unknown` messages and increment unresolved counts

### Production fixes added

- `src/opendream/live-capture.ts`
  - terminal live-capture states now reject subsequent `session.updated`, `message.updated`, and `message.part.updated` mutations
  - finalized sessions keep their previously materialized snapshot contents instead of accepting late-arriving parts

## Completed in Phase 4

### Tests added

- `tests/phase4-hardening.test.ts`
  - stray `<!-- OPENCODE-DREAM:END -->` markers before a valid managed block no longer force append behavior
  - `opendream_export_agents` dry-run preview reports `replace` for the same malformed-marker topology
  - `readReflectionJsonInput` treats empty-string `reflectionJson` as explicitly provided input when checking ambiguity/missing-input rules

### Production fixes added

- `src/opendream/agents-md.ts`
  - added deterministic managed-block bound detection that finds the first valid BEGIN→END pair instead of using the first END anywhere in the file
- `src/tools/opendream-export-agents.ts`
  - dry-run preview now uses the same managed-block detection logic as real AGENTS export
- `src/opendream/reflection.ts`
  - `readReflectionJsonInput` now keys on `undefined` rather than truthiness so empty JSON strings are treated as provided input

## Completed in optional Phase 5

### Tests added

- `tests/phase5-hardening.test.ts`
  - malformed stored reflections now produce structured errors from `opendream_dream_prompt`
  - malformed stored reflections now produce structured errors from `opendream_dream_run` before any model session is created
  - repeated `memory/current.md` → `AGENTS.md` apply/export cycles keep a single managed AGENTS block

### Production fixes added

- `src/tools/opendream-dream-prompt.ts`
  - loads stored reflections with per-file attribution and returns structured invalid-reflection errors instead of throwing
- `src/tools/opendream-dream-run.ts`
  - loads stored reflections with per-file attribution and returns structured invalid-reflection errors before model execution begins

## Completed in optional Phase 6

### Tests added

- `tests/phase6-hardening.test.ts`
  - parseable-but-invalid model consolidation JSON now produces a structured error from `opendream_dream_run`
  - repeated `reflect_import_json` → `dream_run` → `memory_apply` → `export_agents` cycles keep a single managed AGENTS block while preserving accumulated memory

### Production fixes added

- `src/tools/opendream-dream-run.ts`
  - wraps `consolidationFromJson(...)` so invalid parsed model payloads return structured JSON instead of throwing
  - includes the original `rawText` and resolved `model` in invalid-consolidation error responses for diagnosis

## Completed in optional Phase 7

### Tests added

- `tests/phase7-hardening.test.ts`
  - empty session files now produce structured errors from `opendream_reflect_import_json`
  - reflect-import stores reflections under the resolved session/path session ID even when the payload `session_id` disagrees
  - append → replace → append memory-apply cycles keep `memory/current.md` and `AGENTS.md` aligned with exactly one managed AGENTS block

### Production fixes added

- `src/tools/opendream-reflect-import-json.ts`
  - wraps session loading, reflection input parsing, validation, and persistence in a tool-level guard that returns structured JSON errors instead of throwing
  - includes `sessionFilePath` and optional `reflectionFilePath` in error responses for diagnosis

## Completed in optional Phase 8

### Tests added

- `tests/phase8-hardening.test.ts`
  - `opendream_reflect_import_json` already returns a structured error when both `reflectionJson` and `reflectionFilePath` are provided
  - invalid non-empty session shapes at the reflect-import tool boundary already return structured errors with `sessionFilePath`
  - same-ID append updates already replace prior memory content and keep AGENTS dry-run preview/output aligned with final memory state

### Production fixes added

- None required
  - all newly targeted seams were already green once directly covered by regression tests

## Targeted verification completed

- `npm test -- tests/phase1-hardening.test.ts tests/layout-and-agents.test.ts tests/external-memory-integrations.test.ts tests/opencode-dream-smoke.test.ts`
- Result: passing (`76` tests in the targeted set)
- `npm test -- tests/phase2-hardening.test.ts tests/external-memory-integrations.test.ts tests/adversarial.test.ts tests/opencode-dream-smoke.test.ts`
- Result: passing (`73` tests in the targeted set)
- `npm test -- tests/phase3-hardening.test.ts tests/live-capture-edge.test.ts tests/opencode-dream-smoke.test.ts`
- Result: passing (`32` tests in the targeted set)
- `npm test -- tests/phase4-hardening.test.ts tests/layout-and-agents.test.ts tests/self-heal-regressions.test.ts tests/validation-errors.test.ts`
- Result: passing (`63` tests in the targeted set)
- `npm test -- tests/phase5-hardening.test.ts tests/self-heal-regressions.test.ts tests/layout-and-agents.test.ts tests/opencode-dream-smoke.test.ts`
- Result: passing (`49` tests in the targeted set)
- `npm test -- tests/phase6-hardening.test.ts tests/phase5-hardening.test.ts tests/opencode-dream-smoke.test.ts tests/validation-errors.test.ts`
- Result: passing (`48` tests in the targeted set)
- `npm test -- tests/phase7-hardening.test.ts tests/phase6-hardening.test.ts tests/phase5-hardening.test.ts tests/opencode-dream-smoke.test.ts`
- Result: passing (`23` tests in the targeted set)
- `npm test -- tests/phase8-hardening.test.ts tests/phase7-hardening.test.ts tests/phase6-hardening.test.ts tests/phase5-hardening.test.ts tests/opencode-dream-smoke.test.ts tests/validation-errors.test.ts`
- Result: passing (`54` tests in the targeted set)

## Remaining planned work

1. No additional hardening phase is currently queued in this plan.
2. Current optional seams already have direct regression coverage through Phase 8.
3. Any further tests should be driven by a newly observed bug, API change, or new feature surface rather than continued blind fuzzing.

## Resume point

Next recommended action:

1. Re-run `npm run build && npm test` to confirm the fully hardened baseline.
2. If new issues appear, add a reproducing regression test first and fix only the proven seam.
3. Otherwise treat the current Phase 1–8 suite as the maintained hardening baseline.
