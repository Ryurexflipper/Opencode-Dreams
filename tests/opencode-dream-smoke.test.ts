import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { validateGenericJsonlFile } from "../src/opendream/generic-jsonl.js"
import { processDreamEventCapture } from "../src/opendream/live-capture.js"
import { reflectionFromJson, renderDreamReflectionPrompt } from "../src/opendream/reflection.js"
import { writeDreamReflection } from "../src/opendream/fs-store.js"
import { createOpencodeDreamReflectRunTool } from "../src/tools/opendream-reflect-run.js"
import { consolidationFromJson, renderDreamConsolidationPrompt, readReflectionFile } from "../src/opendream/dream.js"
import { writeDreamConsolidation, listReflectionFiles, listDreamConsolidations } from "../src/opendream/dream-store.js"
import { createOpencodeDreamRunTool } from "../src/tools/opendream-dream-run.js"
import { createOpencodeDreamMemoryApplyTool } from "../src/tools/opendream-memory-apply.js"
import type { DreamReflection } from "../src/opendream/reflection.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalReflection(sessionID: string): DreamReflection {
  return reflectionFromJson(
    {
      session_completeness: "completed",
      reflection_confidence: "medium",
      target_task_classification: { type: "debugging", domain: "test", complexity: "simple" },
      observed_work_classification: { type: "debugging", domain: "test", complexity: "simple" },
      approach: { strategy_summary: "Ran tests.", tool_sequence: ["bash"], decision_points: [] },
      observations: { behaviors_observed: [], tool_use_notes: [], context_observations: null },
      outcome: { completed: true, user_satisfied: true, evidence: "tests passed" },
      candidates_for_memory: [
        {
          kind: "workflow",
          content: "Always run typecheck before build.",
          scope: "generalizable",
          evidence: "Seen in multiple sessions",
          confidence: "high",
        },
      ],
    },
    sessionID,
  )
}

// ---------------------------------------------------------------------------
// Original smoke tests (preserved verbatim)
// ---------------------------------------------------------------------------

describe("opencode-dream config", () => {
  it("uses the expected defaults", () => {
    const resolved = resolveDreamConfig("/tmp/project", undefined)
    expect(resolved.pluginId).toBe("opencode-dream")
    expect(resolved.stateDir.endsWith(".opencode-dream")).toBe(true)
    expect(resolved.agentsFile.endsWith("AGENTS.md")).toBe(true)
    expect(resolved.captureLiveSessions).toBe(true)
    expect(resolved.sessionLiveDir.endsWith("sessions/live")).toBe(true)
    expect(resolved.sessionRuntimeDir.endsWith("sessions/runtime")).toBe(true)
  })

  it("accepts upstream generic_jsonl optional fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-jsonl-"))
    const filePath = join(root, "session.jsonl")
    const content = JSON.stringify({
      agent: "build",
      started_at: "2026-05-09T00:00:00.000Z",
      ended_at: "2026-05-09T00:05:00.000Z",
      task_description: "Capture a session",
      project_id: "proj-1",
      outcome_known: true,
      outcome_success: true,
      metadata: { source: "test" },
      messages: [
        {
          index: 0,
          role: "tool",
          content: "done",
          tool_name: "bash",
          tool_input: { command: "pwd" },
          tool_output: "/tmp/project",
          timestamp: "2026-05-09T00:01:00.000Z",
        },
      ],
    })

    await writeFile(filePath, `${content}\n`, "utf8")
    const result = await validateGenericJsonlFile(filePath)

    expect(result.validLines).toBe(1)
    expect(result.invalidLines).toBe(0)
  })

  it("captures a live session snapshot from documented event types", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-dream-live-"))
    const config = resolveDreamConfig(directory, undefined)

    await processDreamEventCapture(config, {
      type: "session.created",
      properties: {
        info: {
          id: "session-1",
          projectID: "project-1",
          directory,
          title: "Investigate capture",
          version: "1",
          time: { created: 1, updated: 1 },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "user",
          time: { created: 2 },
          agent: "build",
          model: { providerID: "github-copilot", modelID: "gpt-5.4" },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "text",
          text: "hello world",
          time: { start: 3, end: 4 },
        },
      },
    })

    const snapshot = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    })

    expect(snapshot?.action).toBe("session-idle-snapshot")
    expect(snapshot?.messageCount).toBe(1)
    expect(snapshot?.filePath).toContain("sessions/live/session-1.jsonl")

    const saved = JSON.parse((await readFile(snapshot?.filePath as string, "utf8")).trim()) as {
      agent: string
      task_description: string
      messages: Array<{ index: number; role: string; content: string; timestamp?: string }>
      metadata: { unresolved_part_count: number }
    }

    expect(saved.agent).toBe("build")
    expect(saved.task_description).toBe("Investigate capture")
    expect(saved.messages).toEqual([
      {
        index: 0,
        role: "user",
        content: "hello world",
        timestamp: "1970-01-01T00:00:00.004Z",
      },
    ])
    expect(saved.metadata.unresolved_part_count).toBe(0)
  })

  it("renders a reflection prompt from an OpenDream-style session", () => {
    const prompt = renderDreamReflectionPrompt({
      agent: "build",
      started_at: "2026-05-09T00:00:00.000Z",
      task_description: "Investigate capture",
      outcome_known: true,
      outcome_success: true,
      messages: [
        {
          index: 0,
          role: "user",
          content: "Inspect the issue",
        },
      ],
    })

    expect(prompt.system).toBe("You are a meta-cognitive observer for an AI agent.")
    expect(prompt.user).toContain("### Task description\nInvestigate capture")
    expect(prompt.user).toContain("[0] user: Inspect the issue")
    expect(prompt.user).toContain("### Outcome (if known)\nsuccess")
  })

  it("validates and stores imported reflection JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-reflection-"))
    const reflection = reflectionFromJson(
      {
        session_completeness: "completed",
        reflection_confidence: "medium",
        target_task_classification: {
          type: "debugging",
          domain: "typescript plugin",
          complexity: "simple",
        },
        observed_work_classification: {
          type: "debugging",
          domain: "typescript plugin",
          complexity: "simple",
        },
        approach: {
          strategy_summary: "Inspected a captured session and validated output.",
          tool_sequence: ["message.updated", "message.part.updated"],
          decision_points: [],
        },
        observations: {
          behaviors_observed: [],
          tool_use_notes: [],
          context_observations: null,
        },
        outcome: {
          completed: true,
          user_satisfied: "unclear",
          evidence: "The trace reached a saved output artifact.",
        },
        candidates_for_memory: [],
      },
      "session-1",
    )

    const filePath = await writeDreamReflection(root, "session-1", reflection)
    const saved = JSON.parse(await readFile(filePath, "utf8")) as { session_id: string; outcome: { completed: boolean } }

    expect(saved.session_id).toBe("session-1")
    expect(saved.outcome.completed).toBe(true)
  })

  it("opendream_reflect_run throws a clear error when no model is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-reflect-run-"))
    const config = resolveDreamConfig(root, { preferredReflectModel: undefined })
    // A stub client — the tool should throw before ever calling it
    const stubClient = {} as Parameters<typeof createOpencodeDreamReflectRunTool>[1]
    const runTool = createOpencodeDreamReflectRunTool(config, stubClient)

    // Write a minimal session file
    const sessionFile = join(root, "session.jsonl")
    await writeFile(
      sessionFile,
      JSON.stringify({
        agent: "build",
        started_at: "2026-05-09T00:00:00.000Z",
        messages: [{ index: 0, role: "user", content: "hello" }],
      }) + "\n",
      "utf8",
    )

    await expect(
      (runTool as unknown as { execute(args: Record<string, unknown>): Promise<string> }).execute({
        sessionFilePath: sessionFile,
      }),
    ).rejects.toThrow(/No reflect model configured/)
  })
})

// ---------------------------------------------------------------------------
// Stage 2: Dream consolidation
// ---------------------------------------------------------------------------

describe("dream consolidation", () => {
  it("renders a consolidation prompt from reflections", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-dream-"))
    const r1 = makeMinimalReflection("session-a")
    const r2 = makeMinimalReflection("session-b")

    const prompt = renderDreamConsolidationPrompt([r1, r2], "## existing memory\n- old fact")

    expect(prompt.system).toContain("synthesis engine")
    expect(prompt.user).toContain("2 session reflection")
    expect(prompt.user).toContain("session-a")
    expect(prompt.user).toContain("old fact")
    expect(prompt.user).toContain("Always run typecheck before build.")
  })

  it("consolidationFromJson validates and returns a typed object", () => {
    const r = makeMinimalReflection("session-test")
    const raw = {
      themes: [
        {
          kind: "workflow",
          title: "Typecheck first",
          summary: "Always run typecheck before build.",
          evidence_count: 2,
          confidence: "high",
          scope: "generalizable",
          source_sessions: ["session-a"],
        },
      ],
      memory_entries: [
        {
          kind: "workflow",
          content: "Always run typecheck before build.",
          confidence: "high",
          scope: "generalizable",
          source_sessions: ["session-a"],
        },
      ],
      synthesis_notes: null,
    }

    const consolidation = consolidationFromJson(raw, [r])
    expect(consolidation.themes).toHaveLength(1)
    expect(consolidation.memory_entries).toHaveLength(1)
    expect(consolidation.session_count).toBe(1)
    expect(consolidation.synthesis_notes).toBeNull()
  })

  it("writeDreamConsolidation + listDreamConsolidations roundtrip", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-dream-store-"))
    const r = makeMinimalReflection("session-x")
    const consolidation = consolidationFromJson(
      {
        themes: [],
        memory_entries: [
          {
            kind: "fact",
            content: "test fact",
            confidence: "medium",
            scope: "generalizable",
            source_sessions: ["session-x"],
          },
        ],
        synthesis_notes: "test run",
      },
      [r],
    )

    const filePath = await writeDreamConsolidation(root, consolidation)
    expect(filePath).toContain("dreams/")

    const listed = await listDreamConsolidations(root)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toBe(filePath)
  })

  it("readReflectionFile roundtrips through writeDreamReflection", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-read-ref-"))
    const reflection = makeMinimalReflection("session-read")
    const filePath = await writeDreamReflection(root, "session-read", reflection)

    const loaded = await readReflectionFile(filePath)
    expect(loaded.session_id).toBe("session-read")
    expect(loaded.candidates_for_memory).toHaveLength(1)
  })

  it("listReflectionFiles finds written reflections", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-list-ref-"))
    await mkdir(join(root, "reflections"), { recursive: true })
    const r = makeMinimalReflection("session-list")
    await writeDreamReflection(root, "session-list", r)

    const listed = await listReflectionFiles(root)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toContain("session-list.json")
  })

  it("opendream_dream_run returns error when no reflections exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-run-empty-"))
    const config = resolveDreamConfig(root, { preferredDreamModel: "github-copilot/gpt-5.4" })
    const stubClient = {} as Parameters<typeof createOpencodeDreamRunTool>[1]
    const dreamTool = createOpencodeDreamRunTool(config, stubClient)

    const result = JSON.parse(
      await (dreamTool as unknown as { execute(args: Record<string, unknown>): Promise<string> }).execute({}),
    ) as { error: string }
    expect(result.error).toMatch(/No reflection files found/)
  })

  it("opendream_dream_run throws when no dream model configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-run-nomodel-"))
    const config = resolveDreamConfig(root, { preferredDreamModel: undefined })
    const stubClient = {} as Parameters<typeof createOpencodeDreamRunTool>[1]
    const dreamTool = createOpencodeDreamRunTool(config, stubClient)

    await expect(
      (dreamTool as unknown as { execute(args: Record<string, unknown>): Promise<string> }).execute({}),
    ).rejects.toThrow(/No dream model configured/)
  })
})

// ---------------------------------------------------------------------------
// opendream_memory_apply
// ---------------------------------------------------------------------------

describe("opendream_memory_apply", () => {
  it("applies memory entries to current.md in append mode (dryRun)", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-mem-apply-"))
    const config = resolveDreamConfig(root, undefined)
    await mkdir(join(root, ".opencode-dream", "dreams"), { recursive: true })

    // Write a consolidation
    const r = makeMinimalReflection("session-mem")
    const consolidation = consolidationFromJson(
      {
        themes: [],
        memory_entries: [
          {
            kind: "workflow",
            content: "Run typecheck before commit.",
            confidence: "high",
            scope: "generalizable",
            source_sessions: ["session-mem"],
          },
        ],
        synthesis_notes: null,
      },
      [r],
    )
    const consolFile = await writeDreamConsolidation(config.stateDir, consolidation)

    const applyTool = createOpencodeDreamMemoryApplyTool(config)
    const raw = await (applyTool as unknown as { execute(args: Record<string, unknown>): Promise<string> }).execute({
      consolidationFilePath: consolFile,
      dryRun: true,
    })
    const result = JSON.parse(raw) as { dryRun: boolean; previewContent: string; memoryEntryCount: number }
    expect(result.dryRun).toBe(true)
    expect(result.memoryEntryCount).toBe(1)
    expect(result.previewContent).toContain("Run typecheck before commit.")
  })

  it("returns error when no consolidation files exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-dream-mem-apply-empty-"))
    const config = resolveDreamConfig(root, undefined)
    const applyTool = createOpencodeDreamMemoryApplyTool(config)

    const raw = await (applyTool as unknown as { execute(args: Record<string, unknown>): Promise<string> }).execute({})
    const result = JSON.parse(raw) as { error: string }
    expect(result.error).toMatch(/No consolidation files found/)
  })
})
