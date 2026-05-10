# Adversarial Reinforcement Loop (25 Iterations)

This loop is designed to keep hardening work fully contained inside this repository.

## Operating rules

- Stay inside `/mnt/g/Opencode-Dream/Opencode-Dream`
- Do not delete files unless explicitly requested
- Prefer failing regression tests first, then minimal fixes
- After each iteration cluster, run targeted verification
- After each phase boundary, run `npm run build && npm test`

## Iteration sequence

1. Re-run the current full suite and snapshot failures/risk areas.
2. Stress `src/config.ts` with more nested relative/absolute in-repo path cases.
3. Stress config rejection with mixed separators and traversal attempts.
4. Probe AGENTS export with repeated embedded begin/end marker payloads.
5. Probe external-memory renderers with multiple injected closing markers per item.
6. Probe external-memory renderers with truncated hostile marker payloads near `maxItemLength`.
7. Re-test repeated `opendream_memory_apply` append behavior with multiple stored consolidations.
8. Re-test `opendream_memory_apply` replace behavior after append history exists.
9. Add non-dry-run `opendream_ext_mem_sync` idempotency tests across multiple sources.
10. Add mixed-success `opendream_ext_mem_sync` non-dry-run tests.
11. Add ingest validation tests to ensure invalid JSONL does not get copied into state.
12. Add import collision tests for same-basename session imports.
13. Add late-event-after-terminal-state tests in `src/opendream/live-capture.ts`.
14. Add multipart interleaving replacement tests in live capture.
15. Add unresolved-role/incomplete-part degradation tests in live capture.
16. Add AGENTS broken-marker-topology tests for malformed existing files.
17. Add direct contract tests for `readReflectionJsonInput` ambiguity handling.
18. Add malformed stored dream/reflection fixture fuzz cases.
19. Add repeated export/import cycle stability tests for `memory/current.md` -> `AGENTS.md`.
20. Add adversarial Unicode/control-character payload tests where safe.
21. Review remaining regex construction sites and add regression tests for each.
22. Re-run security-oriented review against updated code paths.
23. Re-run correctness-oriented review against updated code paths.
24. Consolidate surviving gaps into deferred-risk notes with concrete reproduction steps.
25. Run final `npm run build && npm test` and update the in-repo status summary.

## Exit criteria

- New regression coverage exists for each fixed issue class.
- Full build passes.
- Full test suite passes.
- Deferred risks are documented in-repo with next actions.
