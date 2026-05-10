import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { exportDreamManagedSection } from "../src/opendream/agents-md.js"
import { consolidationFromJson } from "../src/opendream/dream.js"
import { ensureDreamLayout, importFileIntoDreamSessions } from "../src/opendream/fs-store.js"
import { readGenericJsonlSessionFile } from "../src/opendream/generic-jsonl.js"
import {
  reflectionFromJson,
  renderDreamReflectionPrompt,
  resolveDreamSessionID,
} from "../src/opendream/reflection.js"
import { renderOpencodeMemSection } from "../src/integrations/opencode-mem.js"
import { parseLogfmt } from "../src/integrations/simple-memory.js"
import { createOpencodeDreamMemoryApplyTool } from "../src/tools/opendream-memory-apply.js"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent: "build",
    started_at: "2026-05-09T00:00:00.000Z",
    task_description: "Investigate issue",
    messages: [
      {
        index: 0,
        role: "user",
        content: "hello",
      },
    ],
    ...overrides,
  }
}

function makeReflectionData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_completeness: "completed",
    reflection_confidence: "medium",
    target_task_classification: { type: "debugging", domain: "test", complexity: "simple" },
    observed_work_classification: { type: "debugging", domain: "test", complexity: "simple" },
    approach: {
      strategy_summary: "Investigated the problem.",
      tool_sequence: ["bash"],
      decision_points: [],
    },
    observations: {
      behaviors_observed: [],
      tool_use_notes: [],
      context_observations: null,
    },
    outcome: {
      completed: true,
      user_satisfied: true,
      evidence: "tests passed",
    },
    candidates_for_memory: [],
    ...overrides,
  }
}

function makeReflection(sessionID: string) {
  return reflectionFromJson(makeReflectionData(), sessionID)
}

async function runMemoryApplyDryRun(args: {
  existingContent?: string
  consolidation: Record<string, unknown>
  mode: "append" | "replace"
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "adv-memory-apply-"))
  const config = resolveDreamConfig(root, undefined)
  await ensureDreamLayout(config.stateDir)

  if (args.existingContent !== undefined) {
    await writeFile(config.memoryFile, args.existingContent, "utf8")
  }

  const consolidationPath = join(root, "consolidation.json")
  await writeFile(consolidationPath, `${JSON.stringify(args.consolidation, null, 2)}\n`, "utf8")

  const tool = createOpencodeDreamMemoryApplyTool(config) as unknown as {
    execute(input: Record<string, unknown>): Promise<string>
  }

  const output = await tool.execute({
    consolidationFilePath: consolidationPath,
    mode: args.mode,
    dryRun: true,
  })

  return (JSON.parse(output) as { previewContent: string }).previewContent
}

describe("adversarial coverage", () => {
  it("uses opendream_session_id from metadata when present", () => {
    const session = makeSession({
      metadata: {
        opendream_session_id: "dream-123",
        opencode_session_id: "open-456",
      },
    })

    expect(resolveDreamSessionID(session as never)).toBe("dream-123")
  })

  it("falls back to opencode_session_id when opendream_session_id is absent", () => {
    const session = makeSession({
      metadata: {
        opencode_session_id: "open-456",
      },
    })

    expect(resolveDreamSessionID(session as never)).toBe("open-456")
  })

  it("returns a UUID without metadata or sourcePath and uses basename without extension when sourcePath exists", () => {
    const session = makeSession()

    const generated = resolveDreamSessionID(session as never)
    const fromPath = resolveDreamSessionID(session as never, "/tmp/my-session.jsonl")

    expect(generated).toMatch(UUID_RE)
    expect(fromPath).toBe("my-session")
  })

  it("renders unknown outcome when outcome_known is false", () => {
    const prompt = renderDreamReflectionPrompt({
      ...makeSession({ outcome_known: false }),
      messages: [{ index: 0, role: "user", content: "check" }],
    } as never)

    expect(prompt.user).toContain("### Outcome (if known)\nunknown")
  })

  it("renders failure outcome when outcome is known and unsuccessful", () => {
    const prompt = renderDreamReflectionPrompt({
      ...makeSession({ outcome_known: true, outcome_success: false }),
      messages: [{ index: 0, role: "user", content: "check" }],
    } as never)

    expect(prompt.user).toContain("### Outcome (if known)\nfailure")
  })

  it("truncates long messages when maxMessageChars is set", () => {
    const prompt = renderDreamReflectionPrompt(
      {
        ...makeSession(),
        messages: [{ index: 0, role: "user", content: "abcdefghijklmno" }],
      } as never,
      { maxMessageChars: 10 },
    )

    expect(prompt.user).toContain("[0] user: abcdefghij")
    expect(prompt.user).toContain("[truncated: 5 chars elided]")
  })

  it("renders multiple messages with indexed role lines separated by blank lines", () => {
    const prompt = renderDreamReflectionPrompt({
      ...makeSession(),
      messages: [
        { index: 0, role: "user", content: "first" },
        { index: 1, role: "assistant", content: "second" },
      ],
    } as never)

    expect(prompt.user).toContain("[0] user: first\n\n[1] assistant: second")
  })

  it("treats non-array decision_points as an empty array", () => {
    const reflection = reflectionFromJson(
      makeReflectionData({
        approach: {
          strategy_summary: "Used a plan.",
          tool_sequence: ["bash"],
          decision_points: "not-an-array",
        },
      }),
      "session-a",
    )

    expect(reflection.approach.decision_points).toEqual([])
  })

  it("throws when a decision point is missing the moment field", () => {
    expect(() =>
      reflectionFromJson(
        makeReflectionData({
          approach: {
            strategy_summary: "Used a plan.",
            tool_sequence: ["bash"],
            decision_points: [
              {
                choice_made: "picked option A",
                evidence: "saw it work",
              },
            ],
          },
        }),
        "session-b",
      ),
    ).toThrow(/moment/)
  })

  it("parses a low-confidence failure_mode memory candidate", () => {
    const reflection = reflectionFromJson(
      makeReflectionData({
        candidates_for_memory: [
          {
            kind: "failure_mode",
            content: "Do not trust partial sync state.",
            scope: "generalizable",
            evidence: "Observed inconsistent state",
            confidence: "low",
          },
        ],
      }),
      "session-c",
    )

    expect(reflection.candidates_for_memory[0]).toMatchObject({
      kind: "failure_mode",
      confidence: "low",
    })
  })

  it("defaults behaviors_observed valence to neutral when omitted", () => {
    const reflection = reflectionFromJson(
      makeReflectionData({
        observations: {
          behaviors_observed: [
            {
              observation: "Asked clarifying questions",
              evidence: "Conversation trace",
              confidence: "medium",
              scope: "generalizable",
            },
          ],
          tool_use_notes: [],
          context_observations: null,
        },
      }),
      "session-d",
    )

    expect(reflection.observations.behaviors_observed[0]?.valence).toBe("neutral")
  })

  it("throws when a tool_use_note is missing its tool field", () => {
    expect(() =>
      reflectionFromJson(
        makeReflectionData({
          observations: {
            behaviors_observed: [],
            tool_use_notes: [
              {
                note: "Helpful output",
                evidence: "tool call completed",
              },
            ],
            context_observations: null,
          },
        }),
        "session-e",
      ),
    ).toThrow(/tool/)
  })

  it("defaults missing memory_entries to an empty array and preserves synthesis_notes", () => {
    const consolidation = consolidationFromJson(
      {
        themes: [],
        synthesis_notes: "preserve this exactly",
      },
      [makeReflection("session-1")],
    )

    expect(consolidation.memory_entries).toEqual([])
    expect(consolidation.synthesis_notes).toBe("preserve this exactly")
  })

  it("parses low-confidence task_specific memory entries without error", () => {
    const consolidation = consolidationFromJson(
      {
        themes: [],
        memory_entries: [
          {
            kind: "pattern",
            content: "Temporary migration note",
            confidence: "low",
            scope: "task_specific",
            source_sessions: ["session-2"],
          },
        ],
        synthesis_notes: null,
      },
      [makeReflection("session-2")],
    )

    expect(consolidation.memory_entries[0]).toMatchObject({
      confidence: "low",
      scope: "task_specific",
    })
  })

  it("copies a .jsonl source file into sessions/imports and returns the destination path", async () => {
    const root = await mkdtemp(join(tmpdir(), "adv-import-001-"))
    const sourcePath = join(root, "source.jsonl")
    const stateDir = join(root, ".opencode-dream")
    await writeFile(sourcePath, "{}\n", "utf8")

    const destination = await importFileIntoDreamSessions(stateDir, sourcePath)
    const copied = await readFile(destination, "utf8")

    expect(destination).toBe(join(stateDir, "sessions", "imports", "source.jsonl"))
    expect(copied).toBe("{}\n")
  })

  it("appends .jsonl when importing a source file without an extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "adv-import-002-"))
    const sourcePath = join(root, "source")
    const stateDir = join(root, ".opencode-dream")
    await writeFile(sourcePath, "{}\n", "utf8")

    const destination = await importFileIntoDreamSessions(stateDir, sourcePath)

    expect(destination).toBe(join(stateDir, "sessions", "imports", "source.jsonl"))
  })

  it("reads only the first non-blank line from a multi-line JSONL file", async () => {
    const root = await mkdtemp(join(tmpdir(), "adv-jsonl-001-"))
    const filePath = join(root, "session.jsonl")
    await writeFile(
      filePath,
      [
        "",
        JSON.stringify(makeSession({ agent: "first-agent", task_description: "first task" })),
        JSON.stringify(makeSession({ agent: "second-agent", task_description: "second task" })),
      ].join("\n"),
      "utf8",
    )

    const session = await readGenericJsonlSessionFile(filePath)

    expect(session.agent).toBe("first-agent")
    expect(session.task_description).toBe("first task")
  })

  it("succeeds when the first non-blank line is valid JSON and a later line is garbage", async () => {
    const root = await mkdtemp(join(tmpdir(), "adv-jsonl-002-"))
    const filePath = join(root, "session.jsonl")
    await writeFile(
      filePath,
      `${JSON.stringify(makeSession({ agent: "valid-agent" }))}\nnot-json\n`,
      "utf8",
    )

    const session = await readGenericJsonlSessionFile(filePath)

    expect(session.agent).toBe("valid-agent")
  })

  it("throws when a JSONL file contains only blank lines", async () => {
    const root = await mkdtemp(join(tmpdir(), "adv-jsonl-003-"))
    const filePath = join(root, "blank.jsonl")
    await writeFile(filePath, "\n   \n\t\n", "utf8")

    await expect(readGenericJsonlSessionFile(filePath)).rejects.toThrow(/No session rows/)
  })

  it("renders failure_mode entries under the Failure mode heading with task-specific and low-confidence suffixes", async () => {
    const previewContent = await runMemoryApplyDryRun({
      consolidation: {
        id: "dream-format-1",
        created_at: "2026-05-09T00:00:00.000Z",
        session_count: 2,
        reflection_ids: ["r1", "r2"],
        themes: [],
        memory_entries: [
          {
            kind: "failure_mode",
            content: "Watch for stale cache during rollback",
            confidence: "low",
            scope: "task_specific",
            source_sessions: ["session-1"],
          },
        ],
        synthesis_notes: null,
      },
      mode: "append",
    })

    expect(previewContent).toContain("### Failure mode")
    expect(previewContent).toContain("- Watch for stale cache during rollback *(task-specific)* *(low confidence)*")
  })

  it("replace mode rebuilds memory markdown from the consolidation only", async () => {
    const previewContent = await runMemoryApplyDryRun({
      existingContent: "legacy content that should disappear\n",
      consolidation: {
        id: "dream-format-2",
        created_at: "2026-05-09T00:00:00.000Z",
        session_count: 1,
        reflection_ids: ["r3"],
        themes: [],
        memory_entries: [
          {
            kind: "workflow",
            content: "Run verification before claiming success",
            confidence: "high",
            scope: "generalizable",
            source_sessions: ["session-3"],
          },
        ],
        synthesis_notes: null,
      },
      mode: "replace",
    })

    expect(previewContent.startsWith("## Opencode-Dream consolidated memory")).toBe(true)
    expect(previewContent).not.toContain("legacy content that should disappear")
  })

  it("appends instead of replacing when AGENTS.md has a BEGIN marker without an END marker", async () => {
    const root = await mkdtemp(join(tmpdir(), "adv-agents-001-"))
    const agentsFile = join(root, "AGENTS.md")
    await writeFile(
      agentsFile,
      [
        "# AGENTS.md",
        "",
        "Existing guidance.",
        "",
        "<!-- OPENCODE-DREAM:BEGIN -->",
        "incomplete block",
      ].join("\n"),
      "utf8",
    )

    const result = await exportDreamManagedSection(agentsFile, "- appended memory")
    const content = await readFile(agentsFile, "utf8")

    expect(result.action).toBe("appended")
    expect(content).toContain("incomplete block")
    expect(content).toContain("- appended memory")
  })

  it("does not truncate content exactly at maxItemLength and does truncate content one character over", () => {
    const exactSection = renderOpencodeMemSection(
      [{ id: "exact", type: "memory", content: "abcde" }],
      { maxItemLength: 5 },
    )
    const overSection = renderOpencodeMemSection(
      [{ id: "over", type: "memory", content: "abcdef" }],
      { maxItemLength: 5 },
    )

    expect(exactSection).toContain("### [exact]\nabcde\n")
    expect(exactSection).not.toContain("abcde…")
    expect(overSection).toContain("### [over]\nabcde…\n")
  })

  it("parses bare keys as true and unquoted empty values as empty strings", () => {
    const items = parseLogfmt([
      'scope content="from bare key"',
      'scope= content="from empty value"',
    ].join("\n"))

    expect(items).toHaveLength(2)
    expect(items[0]?.scope).toBe("true")
    expect(items[1]?.scope).toBe("")
  })

  it("skips a logfmt line whose content field is an empty quoted string", () => {
    const items = parseLogfmt('content=""')

    expect(items).toEqual([])
  })
})
