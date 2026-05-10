# Adversarial Hardening Plan

## Scope and constraints

- Project root: `/mnt/g/Opencode-Dream/Opencode-Dream`
- All reads, writes, tests, notes, and fixes must stay inside this repository.
- Do not delete files unless explicitly requested.
- Do not modify or create files outside the project root.
- Testing, temp directories created by tests, mocks, stubs, and dry-run paths are allowed.
- Prefer additive regression tests and minimal production fixes over large refactors.

## Objective

Continue the self-healing adversarial pass until the main remaining high-risk surfaces are either:

1. covered by regression tests and fixed, or
2. documented as deferred risks with clear reproduction notes.

## Current verified baseline

- Existing suite is green after the optional Phase 8 coverage pass (see status doc for latest count).
- Already hardened in the prior pass:
  - ext-mem multi-source replace behavior
  - reflect-batch dry-run model independence
  - reflect-batch metadata-derived session dedupe
  - latest consolidation selection by mtime
  - malformed consolidation handling
  - malformed stored reflection rejection
  - export preview parity with managed block rendering
- Hardened in Phase 1:
  - config path confinement for `projectRelativeStateDir`, `memoryFile`, and `agentsFile`
  - managed-marker neutralization for AGENTS export and all external-memory renderers
  - repeated non-dry-run memory apply stability for adversarial consolidation IDs
- Hardened in Phase 2:
  - ext-mem non-dry-run append mode idempotency across repeated writes
  - invalid generic JSONL inputs are not copied into state when validation fails
  - same-basename imports keep prior files via collision-safe suffixing
- Hardened in Phase 3:
  - late message and part updates are ignored after terminal live-capture states
  - interleaved tool/reasoning/text updates preserve final snapshot ordering and same-part replacement
  - unresolved roles degrade into explicit `unknown` messages instead of silent loss
- Hardened in Phase 4:
  - AGENTS export now replaces the first valid managed block even if stray end markers appear earlier in the file
  - export-agents dry-run preview matches malformed-marker replacement behavior
  - `readReflectionJsonInput` now distinguishes omitted input from explicitly provided empty JSON strings
- Hardened in optional Phase 5:
  - `opendream_dream_prompt` returns structured invalid-reflection errors instead of throwing on malformed stored reflection files
  - `opendream_dream_run` returns structured invalid-reflection errors with per-file attribution before any model session is created
  - repeated `memory/current.md` → `AGENTS.md` apply/export cycles preserve a single managed AGENTS block
- Hardened in optional Phase 6:
  - `opendream_dream_run` returns structured invalid-consolidation errors when model output parses but fails consolidation validation
  - end-to-end `reflect_import_json` → `dream_run` → `memory_apply` → `export_agents` cycles remain stable across repeated runs
- Hardened in optional Phase 7:
  - `opendream_reflect_import_json` returns structured malformed-session errors instead of throwing on empty or invalid session files
  - reflect-import tool behavior is pinned so payload `session_id` is overwritten by the resolved session/path session ID
  - append → replace → append memory cycles keep `memory/current.md` and `AGENTS.md` aligned with a single managed AGENTS block
- Covered in optional Phase 8 (no production fix required):
  - `opendream_reflect_import_json` already handles reflectionJson/reflectionFilePath ambiguity with structured tool-boundary errors
  - invalid non-empty session shapes at the reflect-import tool boundary already return structured errors
  - same-ID append updates and AGENTS export dry-run preview already stay aligned with the final memory state

## Remaining priority surfaces

### P0 — repository safety and injection resistance

1. **Config path confinement**
   - Target: `src/config.ts`
   - Risk: `projectRelativeStateDir`, `memoryFile`, and `agentsFile` may escape project root through absolute paths or `..` traversal.
   - Goal: reject or normalize any path that resolves outside the repository root.

2. **Managed-marker injection in imported memory content**
   - Targets:
     - `src/integrations/opencode-mem.ts`
     - `src/integrations/simple-memory.ts`
     - `src/integrations/true-mem.ts`
     - `src/integrations/opencode-lcm.ts`
     - `src/opendream/agents-md.ts`
   - Risk: untrusted content may inject marker comments like `<!-- /opencode-mem:sync -->` or `<!-- OPENCODE-DREAM:END -->`.
   - Goal: escape or neutralize managed markers so imported content cannot break managed sections.

3. **Regex safety in memory application**
   - Target: `src/tools/opendream-memory-apply.ts`
   - Status: partially hardened.
   - Goal: verify repeated append/apply behavior remains safe with adversarial IDs and real stored consolidations.

### P1 — correctness and idempotency

4. **Repeated non-dry-run memory apply behavior**
   - Targets:
     - `src/tools/opendream-memory-apply.ts`
     - `src/opendream/dream.ts`
   - Goal: applying the same consolidation repeatedly should be stable and not duplicate or corrupt memory blocks.

5. **Repeated external-memory sync behavior**
   - Target: `src/tools/opendream-ext-mem-sync.ts`
   - Goal: non-dry-run syncs should be idempotent per source and preserve all managed source blocks.

6. **Ingest validation versus state-copy semantics**
   - Targets:
     - `src/tools/opendream-ingest-generic-jsonl.ts`
     - `src/opendream/fs-store.ts`
   - Goal: invalid input should not be copied into state when validation fails.

### P1 — live capture robustness

7. **Late event handling after terminal state**
   - Target: `src/opendream/live-capture.ts`
   - Goal: late events after terminal/session-final states must not corrupt finalized snapshots.

8. **Multipart interleaving and same-part replacement**
   - Target: `src/opendream/live-capture.ts`
   - Goal: interleaved tool/reasoning/text updates should preserve final snapshot correctness.

9. **Safe degradation for unresolved roles/parts**
   - Target: `src/opendream/live-capture.ts`
   - Goal: malformed or incomplete capture streams should degrade safely instead of corrupting saved sessions.

### P2 — secondary hardening opportunities

10. **AGENTS export broken-marker topology**
    - Targets:
      - `src/opendream/agents-md.ts`
      - `src/tools/opendream-export-agents.ts`
    - Goal: damaged marker structures should fail safely or repair deterministically.

11. **Ambiguous reflection JSON input handling**
    - Target: `src/opendream/reflection.ts`
    - Goal: pin `readReflectionJsonInput` contract with direct tests.

12. **Import collision handling**
    - Target: `src/opendream/fs-store.ts`
    - Goal: same-basename imports should not silently overwrite prior imported sessions.

## Execution method

For each issue cluster:

1. Add failing regression tests first.
2. Run the narrowest relevant test file to confirm RED.
3. Implement the smallest production fix.
4. Re-run the targeted test file until GREEN.
5. Run broader verification once the cluster is complete.

## Planned work order

### Phase 1

- [x] Config path confinement
- [x] Managed-marker injection safety
- [x] Direct tests for repeated memory apply behavior

### Phase 2

- [x] External-memory sync idempotency
- [x] Ingest validation versus copy-to-state behavior
- [x] Import collision handling

### Phase 3

- [x] Live-capture late-event corruption resistance
- [x] Multipart interleaving correctness
- [x] Safe degradation for incomplete capture streams

### Phase 4

- [x] AGENTS broken-marker handling
- [x] Reflection input ambiguity tests
- [x] Any adjacent issues discovered during Phases 1–3

### Optional Phase 5

- [x] Malformed stored reflection handling at dream tool boundaries
- [x] Memory-to-AGENTS export/apply cycle stability

### Optional Phase 6

- [x] Malformed stored dream consolidation / model-response validation at tool boundaries
- [x] End-to-end reflection import → dream run → memory apply → AGENTS export cycle stability

### Optional Phase 7

- [x] Malformed reflection-import session / payload mismatch handling at the tool boundary
- [x] Multi-consolidation append/replace interaction fuzzing around `memory/current.md` and `AGENTS.md`

### Optional Phase 8

- [x] Reflection-import JSON/file ambiguity and broader invalid-session-shape coverage
- [x] Multi-consolidation same-ID collision and export preview parity fuzzing

## Verification gates

- After each cluster: targeted `npm test -- <relevant files>`
- After each phase: `npm run build && npm test`
- Final repository exit condition:
  - all new regression tests committed in-repo
  - full build passes
  - full test suite passes
  - unresolved risks documented in-repo

## Deliverables to leave in-repo

- This plan file
- New regression tests for each fixed bug class
- Minimal production patches
- A final summary document listing:
  - issues fixed
  - tests added
  - final build/test status
  - deferred risks and recommended next adversarial rounds
