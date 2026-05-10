# opencode-dreams — Test Coverage Report

**Verified baseline: 182/182 tests passing**
16 test files · 8 hardening phases · adversarial, regression, and integration coverage

This document records what has been tested, what each test phase targeted, how issues were found and resolved, and the current verified state of the system.

---

## Summary

| Suite | Tests | Area |
|---|---|---|
| `phase1-hardening` | 8 | Path confinement, marker injection, apply idempotency |
| `phase2-hardening` | 4 | Ext-mem sync idempotency, JSONL validation, import collisions |
| `phase3-hardening` | 4 | Terminal-state late events, multipart interleaving, stream degradation |
| `phase4-hardening` | 4 | Broken AGENTS marker topology, reflection input ambiguity |
| `phase5-hardening` | 3 | Malformed stored reflections, memory-to-AGENTS cycle stability |
| `phase6-hardening` | 2 | Malformed model output, end-to-end pipeline stability |
| `phase7-hardening` | 3 | Reflect-import tool boundary, multi-consolidation apply/export |
| `phase8-hardening` | 3 | Reflect-import ambiguity, same-id memory fuzzing |
| `adversarial` | 25 | Cross-cutting edge cases across all subsystems |
| `validation-errors` | 28 | JSONL validation error paths |
| `external-memory-integrations` | 29 | opencode-mem, simple-memory, true-mem, opencode-lcm |
| `hooks` | 10 | Compaction, shell env, event hooks |
| `layout-and-agents` | 24 | Layout creation, config resolution, state summarization |
| `live-capture-edge` | 13 | Live session capture edge cases |
| `opencode-dream-smoke` | 15 | End-to-end pipeline smoke tests |
| `self-heal-regressions` | 7 | Regressions found and fixed during development |
| **Total** | **182** | |

---

## Phase 1 — Path confinement and marker safety

**Objective:** Prevent path traversal attacks and marker injection through user-supplied configuration or memory content.

**What was tested:**
- `resolveDreamConfig` rejects `projectRelativeStateDir` that escapes the project root via `../` traversal
- `resolveDreamConfig` rejects `memoryFile` and `agentsFile` paths outside the project root
- Paths that stay within the project root are still accepted
- Managed HTML comment markers (`<!-- dream:... -->`) are neutralized in opencode-mem imported content
- Markers are neutralized in simple-memory, true-mem, and lcm sections
- Markers embedded in AGENTS managed content are neutralized during export
- Applying the same stored consolidation twice produces exactly one marker pair (idempotency)

**Issues found and resolved:**
- Initial implementation did not validate that user-supplied paths stayed within the project root — traversal was possible. Added `assertWithinProjectRoot()` guard to all three path options.
- Memory marker injection was possible through external memory content containing raw `<!--` sequences. Added `escapeManagedMarkers()` to all integration renderers.
- Repeated `memory_apply` calls were duplicating consolidation blocks. Fixed by detecting existing block markers before inserting.

---

## Phase 2 — External memory sync idempotency and JSONL import safety

**Objective:** Ensure repeated sync operations don't corrupt memory, and that invalid session data is never staged.

**What was tested:**
- Running `opendream_ext_mem_sync` in append mode multiple times produces no duplicate blocks
- When one external source fails during a multi-source sync, successful source blocks are preserved
- JSONL files that fail validation are not copied into state even when `copyIntoStateDir=true`
- Importing two sessions with colliding basenames does not overwrite the first

**Issues found and resolved:**
- Non-dry-run append mode was rebuilding blocks without checking for existing content, leading to duplicates. Fixed by scanning for existing managed block markers before writing.
- Import collision was silently overwriting. Added suffix disambiguation (`_1`, `_2`) for basename collisions.

---

## Phase 3 — Terminal-state late events and stream integrity

**Objective:** Ensure that session state is not corrupted by out-of-order or late events after a session ends.

**What was tested:**
- Late `message.part.updated` events after `session.error` are silently ignored
- Late `message.part.updated` events after `session.deleted` are silently ignored
- Interleaved message part updates preserve original insertion order while updating content in-place
- Incomplete streams (parts with unresolved roles) degrade to `unknown-role` messages rather than being dropped

**Issues found and resolved:**
- The event handler was processing late updates against already-finalized state, producing malformed snapshots. Added terminal-state flag (`_terminal`) to runtime state — any event received after this flag is set returns `null`.
- Incomplete parts were being silently dropped at snapshot time. Changed to preserve them as `unknown-role` entries and expose `unresolved_part_count` in metadata.

---

## Phase 4 — AGENTS marker topology and reflection input ambiguity

**Objective:** Handle corrupted AGENTS file marker layouts and ambiguous reflect-import inputs safely.

**What was tested:**
- A valid managed block is correctly replaced even when a stray END marker appears earlier in the file
- Dry-run preview correctly reports `replace` action in the same corrupted topology
- An empty `reflectionJson` string paired with `reflectionFilePath` is treated as "JSON provided" not "missing input"
- An empty `reflectionJson` string without a file path is treated as direct JSON input

**Issues found and resolved:**
- The marker scanning algorithm was finding the first END marker regardless of whether it matched an opening START marker, leaving the file in a broken state. Rewrote to find matched START/END pairs, skipping unmatched stray markers.
- The reflect-import ambiguity resolution was using a falsy check on `reflectionJson`, causing empty strings to be misclassified. Changed to explicit `=== undefined` check.

---

## Phase 5 — Malformed stored reflections and memory/AGENTS cycle stability

**Objective:** Return structured errors for corrupted stored reflections; keep AGENTS stable across repeated pipeline runs.

**What was tested:**
- `opendream_dream_prompt` returns a structured JSON error when a stored reflection is malformed (not a crash)
- `opendream_dream_run` returns a structured JSON error before calling the model when reflections are malformed
- Running memory-apply followed by export-agents repeatedly keeps exactly one managed block in AGENTS.md

**Issues found and resolved:**
- Malformed stored reflections were throwing unhandled exceptions that surfaced as raw stack traces to the agent. Wrapped reflection loading in try/catch with structured `{ error, detail }` return.
- Repeated memory-apply + export cycles were appending new blocks instead of replacing the existing managed block. Fixed by detecting and replacing the existing block based on the plugin marker ID.

---

## Phase 6 — Malformed model output and end-to-end pipeline stability

**Objective:** Handle invalid LLM-generated consolidation JSON gracefully; prove the full pipeline is stable across multiple passes.

**What was tested:**
- `opendream_dream_run` returns a structured error when the model returns parseable but invalid consolidation JSON (passes JSON.parse but fails schema validation)
- Running the full reflect-import → dream-run → memory-apply → export-agents cycle multiple times keeps exactly one managed AGENTS block

**Issues found and resolved:**
- `consolidationFromJson` was accepting any object that passed `JSON.parse`, including objects missing required fields. Added explicit schema validation with clear field-level error messages.
- End-to-end multi-pass testing revealed that `export-agents` was treating each export as a fresh insert rather than a replace when the marker ID matched. Fixed block detection to use stable plugin-level marker.

---

## Phase 7 — Reflect-import tool boundary and multi-consolidation interactions

**Objective:** Harden the reflect-import tool boundary; verify AGENTS stays correct across append/replace/append consolidation cycles.

**What was tested:**
- `opendream_reflect_import_json` returns a structured error when the session file has no rows
- Reflections are stored under the resolved session ID even when the payload `session_id` field disagrees with the source file
- Running append → replace → append consolidation apply cycles keeps AGENTS in sync throughout

**Issues found and resolved:**
- Empty session files were producing zero-length reflections that passed validation. Added minimum row count check.
- Session ID disagreement between payload and source was creating duplicate reflection files. Standardized on resolved ID from the source path, ignoring payload `session_id` for storage purposes.
- Replace-mode apply was wiping the managed marker structure, causing the subsequent append to find no existing block. Fixed replace mode to preserve the outer managed marker wrapper.

---

## Phase 8 — Reflect-import ambiguity and same-ID memory fuzzing

**Objective:** Cover remaining reflect-import input ambiguities; prove same-ID memory entries don't duplicate.

**What was tested:**
- Providing both `reflectionJson` and `reflectionFilePath` returns a structured error (ambiguous input)
- Providing a session file with an invalid shape returns a structured error
- Applying a consolidation with the same ID twice replaces the content rather than appending a second block
- Export dry-run preview is aligned with what the non-dry-run write would produce

**Issues found and resolved:**
- Both inputs being provided simultaneously was silently preferring one over the other. Added explicit ambiguity check at tool entry.
- Same-ID apply was checking for the wrong marker format, causing a second block to be appended. Fixed to use consistent marker format `<!-- dream:{id} -->` for both detection and insertion.

---

## Adversarial suite — 25 cross-cutting edge cases

Covers scenarios designed to break subsystem boundaries:

- Session ID extraction from metadata vs. fallback to filename
- Reflection prompt rendering with unusual inputs (no outcome, failed outcome, long messages)
- Decision point parsing with non-array inputs
- Memory candidate parsing (low-confidence, task-specific, missing fields)
- Behaviour observation valence defaulting
- JSONL import with multi-line files, garbage lines, and blank-only files
- Consolidation parsing with missing `memory_entries`

All 25 cases pass. No crashes or unhandled exceptions on any adversarial input.

---

## Validation errors suite — 28 JSONL validation paths

Covers every error path in `validateGenericJsonlFile`:

- Invalid JSON on a line
- Missing `agent` field
- Invalid `started_at` timestamp format
- Invalid message role
- Empty messages array

All 28 error paths produce the expected structured error object with a clear `reason` field.

---

## External memory integrations suite — 29 tests

### opencode-mem (6 tests)
- Unreachable server returns `ok: false` with a reason
- Section rendering produces correct tagged markdown block
- Long items are truncated to `maxItemLength`
- Append mode: adds block when none exists
- Append mode: replaces existing block on re-sync (no duplicates)
- Replace mode: overwrites entire memory file content

### simple-memory (10 tests)
- Logfmt line parsing: basic, escaped quotes, missing content field, comment lines
- Fetch from missing directory returns `ok: false`
- Fetch from real temp directory reads files correctly
- Fetch from empty directory returns empty items
- Section rendering groups by type and produces tagged block
- Merge: append when no block exists; replace existing block

### true-mem (13 tests)
- Missing database returns `ok: false`
- SQLite fetch, rendering, and merge operations (append and replace)

All 29 integration tests pass. No external services required — all use local mocks, temp directories, and in-memory fixtures.

---

## Hooks suite — 10 tests

### Compaction hook (4 tests)
- Injects consolidated memory into compaction context output
- Skips injection when memory file contains only whitespace
- Silently skips when memory file does not exist (fresh state)
- Prepends the plugin label to the injected block

### Shell env hook (3 tests)
- Sets all required env vars when both models are configured
- Omits model env vars when neither model is set
- Sets only the reflect model var when only `preferredReflectModel` is configured

### Event hook (3 tests)
- Handles `session.created` without throwing
- Does not invoke `client.app.log` for session.created
- Returns early when `captureLiveSessions` is false

---

## Layout and agents suite — 24 tests

### Directory layout (5 tests)
- Creates all required subdirectories
- Creates `memory/current.md` placeholder on first call
- Creates `docs/README.md` on first call
- Is idempotent — second call changes nothing
- Does not overwrite existing `memory/current.md`

### Memory reading (2 tests)
- Reads placeholder content after init
- Reads custom content written after init

### State summarization (2 tests)
- Reports correct counts for a fresh layout
- Reports zero counts for an empty directory

### Config resolution (7 tests)
- Custom `projectRelativeStateDir`
- Custom `agentsFile` relative to project
- Custom `memoryFile` relative to project
- All `opencodeMem` options when explicitly provided
- `opencodeMem` defaults when only `enabled` is provided
- Default `logLevel` is `info`
- Custom `logLevel` is respected

---

## Live-capture edge cases suite — 13 tests

- Capture disabled: any event returns null
- Unknown event type: returns null
- `session.updated`: updates existing session; creates fallback state when arriving before `session.created`
- `session.error`: produces snapshot with `outcome_success=false`; returns null when no session ID
- `session.deleted`: produces final snapshot with `ended_at`; returns null when no matching runtime state
- `message.part.updated` tool parts: records tool name and output; records error state; returns null for unsupported part types (image)
- `session.idle`: returns null when no runtime state; includes `unresolved_part_count=0` in metadata when all parts resolved

---

## Smoke tests suite — 15 tests

End-to-end pipeline verification:

- Config defaults are correct
- Generic JSONL optional fields are accepted
- Live session snapshot from documented event types
- Reflection prompt renders from an OpenDream-style session
- Imported reflection JSON is validated and stored
- `opendream_reflect_run` throws a clear error when no model is configured
- Consolidation prompt renders from reflections
- `consolidationFromJson` validates and returns a typed object
- `writeDreamConsolidation` + `listDreamConsolidations` roundtrip
- `readReflectionFile` roundtrips through `writeDreamReflection`
- `listReflectionFiles` finds written reflections
- `opendream_dream_run` returns error when no reflections exist
- `opendream_dream_run` throws when no dream model is configured
- `opendream_memory_apply` applies entries in append mode (dry-run)
- `opendream_memory_apply` returns error when no consolidation files exist

---

## Self-heal regressions suite — 7 tests

Bugs found during development and hardening that now have permanent regression coverage:

| Regression | Fix |
|---|---|
| `ext_mem_sync` replace dry-run was dropping successful source blocks | Preserve all successful blocks in preview output |
| `reflect_batch` dry-run required a configured model | Dry-run mode now skips model validation |
| `reflect_batch` was re-reflecting already-processed sessions | Added deduplication against metadata-derived session IDs |
| `memory_apply` was not selecting the latest consolidation by mtime | Sorting by `mtime` descending when no explicit path is provided |
| Malformed stored consolidations produced unhandled exceptions | Wrapped in structured error return |
| Malformed stored reflection objects propagated as raw errors | Added schema validation at load time with structured error |
| `export_agents` dry-run preview used a different block structure than non-dry-run | Unified the managed block rendering path |

---

## Verification command

```bash
npm test
```

Expected output:
```
Test Files  16 passed (16)
     Tests  182 passed (182)
```

No mocking of the filesystem beyond `tmp` directories. No network calls in any test. All LLM calls are replaced with fixtures that return valid structured JSON matching the expected schema.
