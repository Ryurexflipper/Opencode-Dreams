/**
 * Tests for validation error paths:
 *   - validateGenericJsonlFile  (opendream/generic-jsonl.ts)
 *   - reflectionFromJson        (opendream/reflection.ts)
 *   - consolidationFromJson     (opendream/dream.ts)
 */

import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { validateGenericJsonlFile } from "../src/opendream/generic-jsonl.js"
import { reflectionFromJson } from "../src/opendream/reflection.js"
import { consolidationFromJson } from "../src/opendream/dream.js"

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const VALID_LINE = JSON.stringify({
  agent: "build",
  started_at: "2026-05-09T00:00:00.000Z",
  messages: [{ index: 0, role: "user", content: "hello" }],
})

const MINIMAL_REFLECTION_DATA = {
  session_completeness: "completed",
  reflection_confidence: "medium",
  target_task_classification: { type: "debugging", domain: "test", complexity: "simple" },
  observed_work_classification: { type: "debugging", domain: "test", complexity: "simple" },
  approach: { strategy_summary: "Did stuff.", tool_sequence: [], decision_points: [] },
  observations: { behaviors_observed: [], tool_use_notes: [], context_observations: null },
  outcome: { completed: true, user_satisfied: true, evidence: "tests passed" },
  candidates_for_memory: [],
}

// ---------------------------------------------------------------------------
// validateGenericJsonlFile — error paths
// ---------------------------------------------------------------------------

describe("validateGenericJsonlFile error paths", () => {
  it("counts an invalid JSON line as invalid and records an error entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-bad-json-"))
    const file = join(root, "bad.jsonl")
    await writeFile(file, "this is not json\n", "utf8")

    const result = await validateGenericJsonlFile(file)

    expect(result.validLines).toBe(0)
    expect(result.invalidLines).toBe(1)
    expect(result.sampleErrors).toHaveLength(1)
    expect(result.sampleErrors[0]).toMatch(/invalid JSON/i)
  })

  it("reports an error when the agent field is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-no-agent-"))
    const file = join(root, "no-agent.jsonl")
    await writeFile(
      file,
      JSON.stringify({
        started_at: "2026-05-09T00:00:00.000Z",
        messages: [{ index: 0, role: "user", content: "hello" }],
      }) + "\n",
      "utf8",
    )

    const result = await validateGenericJsonlFile(file)

    expect(result.invalidLines).toBe(1)
    expect(result.sampleErrors[0]).toMatch(/agent/)
  })

  it("reports an error when started_at is not a valid ISO 8601 timestamp", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-bad-ts-"))
    const file = join(root, "bad-ts.jsonl")
    await writeFile(
      file,
      JSON.stringify({
        agent: "build",
        started_at: "not-a-timestamp",
        messages: [{ index: 0, role: "user", content: "hello" }],
      }) + "\n",
      "utf8",
    )

    const result = await validateGenericJsonlFile(file)

    expect(result.invalidLines).toBe(1)
    expect(result.sampleErrors[0]).toMatch(/started_at|ISO/)
  })

  it("reports an error when a message entry has an invalid role", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-bad-role-"))
    const file = join(root, "bad-role.jsonl")
    await writeFile(
      file,
      JSON.stringify({
        agent: "build",
        started_at: "2026-05-09T00:00:00.000Z",
        messages: [{ index: 0, role: "admin", content: "hello" }],
      }) + "\n",
      "utf8",
    )

    const result = await validateGenericJsonlFile(file)

    expect(result.invalidLines).toBe(1)
    expect(result.sampleErrors[0]).toMatch(/role/)
  })

  it("reports an error when the messages array is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-empty-msgs-"))
    const file = join(root, "empty-msgs.jsonl")
    await writeFile(
      file,
      JSON.stringify({
        agent: "build",
        started_at: "2026-05-09T00:00:00.000Z",
        messages: [],
      }) + "\n",
      "utf8",
    )

    const result = await validateGenericJsonlFile(file)

    expect(result.invalidLines).toBe(1)
    expect(result.sampleErrors[0]).toMatch(/messages/)
  })

  it("reports an error when messages is not an array at all", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-msgs-type-"))
    const file = join(root, "msgs-type.jsonl")
    await writeFile(
      file,
      JSON.stringify({
        agent: "build",
        started_at: "2026-05-09T00:00:00.000Z",
        messages: "not an array",
      }) + "\n",
      "utf8",
    )

    const result = await validateGenericJsonlFile(file)

    expect(result.invalidLines).toBe(1)
    expect(result.sampleErrors[0]).toMatch(/messages/)
  })

  it("correctly tallies valid and invalid lines in a mixed file", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-mixed-"))
    const file = join(root, "mixed.jsonl")
    const lines = [
      VALID_LINE,
      "garbage line that is not json",
      VALID_LINE,
      JSON.stringify({ agent: "build", started_at: "bad-ts", messages: [{ index: 0, role: "user", content: "x" }] }),
    ].join("\n") + "\n"
    await writeFile(file, lines, "utf8")

    const result = await validateGenericJsonlFile(file)

    expect(result.totalLines).toBe(4)
    expect(result.validLines).toBe(2)
    expect(result.invalidLines).toBe(2)
  })

  it("does not count blank lines as invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-blanks-"))
    const file = join(root, "blanks.jsonl")
    await writeFile(file, `${VALID_LINE}\n\n   \n`, "utf8")

    const result = await validateGenericJsonlFile(file)

    expect(result.validLines).toBe(1)
    expect(result.invalidLines).toBe(0)
    // totalLines only counts non-blank lines
    expect(result.totalLines).toBe(1)
  })

  it("reports an error for optional ended_at with an invalid timestamp format", async () => {
    const root = await mkdtemp(join(tmpdir(), "jsonl-bad-ended-"))
    const file = join(root, "bad-ended.jsonl")
    await writeFile(
      file,
      JSON.stringify({
        agent: "build",
        started_at: "2026-05-09T00:00:00.000Z",
        ended_at: "yesterday",
        messages: [{ index: 0, role: "user", content: "hello" }],
      }) + "\n",
      "utf8",
    )

    const result = await validateGenericJsonlFile(file)

    expect(result.invalidLines).toBe(1)
    expect(result.sampleErrors[0]).toMatch(/ended_at|ISO/)
  })
})

// ---------------------------------------------------------------------------
// reflectionFromJson — validation errors
// ---------------------------------------------------------------------------

describe("reflectionFromJson validation errors", () => {
  it("throws when the payload is not an object", () => {
    expect(() => reflectionFromJson("a string", "sess-1")).toThrow(/must be an object/)
    expect(() => reflectionFromJson(42, "sess-1")).toThrow(/must be an object/)
    expect(() => reflectionFromJson(null, "sess-1")).toThrow(/must be an object/)
  })

  it("throws on an invalid session_completeness value", () => {
    expect(() =>
      reflectionFromJson(
        { ...MINIMAL_REFLECTION_DATA, session_completeness: "unknown_state" },
        "sess-1",
      ),
    ).toThrow(/session_completeness/)
  })

  it("throws on an invalid reflection_confidence value", () => {
    expect(() =>
      reflectionFromJson(
        { ...MINIMAL_REFLECTION_DATA, reflection_confidence: "ultra" },
        "sess-1",
      ),
    ).toThrow(/reflection_confidence/)
  })

  it("throws when approach.strategy_summary is missing or empty", () => {
    expect(() =>
      reflectionFromJson(
        {
          ...MINIMAL_REFLECTION_DATA,
          approach: { tool_sequence: [], decision_points: [] }, // strategy_summary absent
        },
        "sess-1",
      ),
    ).toThrow(/strategy_summary/)
  })

  it("throws when outcome.completed has an unsupported value", () => {
    expect(() =>
      reflectionFromJson(
        {
          ...MINIMAL_REFLECTION_DATA,
          outcome: { completed: "maybe", user_satisfied: true, evidence: "ok" },
        },
        "sess-1",
      ),
    ).toThrow(/completed/)
  })

  it("throws when target_task_classification.type is not a recognised enum value", () => {
    expect(() =>
      reflectionFromJson(
        {
          ...MINIMAL_REFLECTION_DATA,
          target_task_classification: { type: "hacking", domain: "test", complexity: "simple" },
        },
        "sess-1",
      ),
    ).toThrow(/type/)
  })

  it("throws when target_task_classification.complexity is invalid", () => {
    expect(() =>
      reflectionFromJson(
        {
          ...MINIMAL_REFLECTION_DATA,
          target_task_classification: { type: "debugging", domain: "test", complexity: "enormous" },
        },
        "sess-1",
      ),
    ).toThrow(/complexity/)
  })

  it("generates a UUID id when the payload does not include one", () => {
    const reflection = reflectionFromJson(MINIMAL_REFLECTION_DATA, "sess-uuid-test")
    expect(typeof reflection.id).toBe("string")
    expect(reflection.id.length).toBeGreaterThan(0)
  })

  it("preserves an id already present in the payload", () => {
    const reflection = reflectionFromJson(
      { ...MINIMAL_REFLECTION_DATA, id: "my-custom-id" },
      "sess-custom-id",
    )
    expect(reflection.id).toBe("my-custom-id")
  })

  it("assigns the sessionID argument regardless of any id in the payload", () => {
    const reflection = reflectionFromJson(MINIMAL_REFLECTION_DATA, "forced-session-id")
    expect(reflection.session_id).toBe("forced-session-id")
  })
})

// ---------------------------------------------------------------------------
// consolidationFromJson — validation errors
// ---------------------------------------------------------------------------

describe("consolidationFromJson validation errors", () => {
  it("throws when the payload is not an object", () => {
    expect(() => consolidationFromJson("not an object", [])).toThrow(/must be an object/)
    expect(() => consolidationFromJson(null, [])).toThrow(/must be an object/)
    expect(() => consolidationFromJson([], [])).toThrow(/must be an object/)
  })

  it("throws on an invalid theme kind", () => {
    expect(() =>
      consolidationFromJson(
        {
          themes: [
            {
              kind: "invalid_kind",
              title: "Test",
              summary: "A summary.",
              evidence_count: 1,
              confidence: "high",
              scope: "generalizable",
              source_sessions: ["sess-1"],
            },
          ],
          memory_entries: [],
          synthesis_notes: null,
        },
        [],
      ),
    ).toThrow(/kind/)
  })

  it("throws on an invalid confidence enum in memory_entries", () => {
    expect(() =>
      consolidationFromJson(
        {
          themes: [],
          memory_entries: [
            {
              kind: "workflow",
              content: "Some content.",
              confidence: "very_high",
              scope: "generalizable",
              source_sessions: ["sess-1"],
            },
          ],
          synthesis_notes: null,
        },
        [],
      ),
    ).toThrow(/confidence/)
  })

  it("throws when themes[i].evidence_count is not a number", () => {
    expect(() =>
      consolidationFromJson(
        {
          themes: [
            {
              kind: "workflow",
              title: "Test",
              summary: "A summary.",
              evidence_count: "three",
              confidence: "high",
              scope: "generalizable",
              source_sessions: ["sess-1"],
            },
          ],
          memory_entries: [],
          synthesis_notes: null,
        },
        [],
      ),
    ).toThrow(/evidence_count/)
  })

  it("throws when themes[i].source_sessions is not an array of strings", () => {
    expect(() =>
      consolidationFromJson(
        {
          themes: [
            {
              kind: "workflow",
              title: "Test",
              summary: "A summary.",
              evidence_count: 1,
              confidence: "high",
              scope: "generalizable",
              source_sessions: [123, 456], // numbers, not strings
            },
          ],
          memory_entries: [],
          synthesis_notes: null,
        },
        [],
      ),
    ).toThrow(/source_sessions/)
  })

  it("throws when memory_entries[i].content is empty", () => {
    expect(() =>
      consolidationFromJson(
        {
          themes: [],
          memory_entries: [
            {
              kind: "workflow",
              content: "   ", // whitespace-only — fails assertString
              confidence: "high",
              scope: "generalizable",
              source_sessions: ["sess-1"],
            },
          ],
          synthesis_notes: null,
        },
        [],
      ),
    ).toThrow(/content/)
  })

  it("produces empty themes and memory_entries when those keys are absent", () => {
    const result = consolidationFromJson(
      { synthesis_notes: "nothing to consolidate" },
      [],
    )

    expect(result.themes).toHaveLength(0)
    expect(result.memory_entries).toHaveLength(0)
    expect(result.synthesis_notes).toBe("nothing to consolidate")
  })

  it("sets session_count from the provided reflections array", () => {
    const r1 = reflectionFromJson(MINIMAL_REFLECTION_DATA, "sess-a")
    const r2 = reflectionFromJson(MINIMAL_REFLECTION_DATA, "sess-b")

    const result = consolidationFromJson(
      { themes: [], memory_entries: [], synthesis_notes: null },
      [r1, r2],
    )

    expect(result.session_count).toBe(2)
    expect(result.reflection_ids).toHaveLength(2)
  })

  it("synthesis_notes may be null", () => {
    const result = consolidationFromJson(
      { themes: [], memory_entries: [], synthesis_notes: null },
      [],
    )
    expect(result.synthesis_notes).toBeNull()
  })
})
