import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { ensureDreamLayout } from "../src/opendream/fs-store.js"
import { consolidationFromJson } from "../src/opendream/dream.js"
import { writeDreamConsolidation } from "../src/opendream/dream-store.js"
import { reflectionFromJson } from "../src/opendream/reflection.js"
import { createOpencodeDreamRunTool } from "../src/tools/opendream-dream-run.js"
import { createOpencodeDreamPromptTool } from "../src/tools/opendream-dream-prompt.js"
import { createOpencodeDreamExportAgentsTool } from "../src/tools/opendream-export-agents.js"
import { createOpencodeDreamMemoryApplyTool } from "../src/tools/opendream-memory-apply.js"

function makeReflection(sessionID: string) {
  return reflectionFromJson(
    {
      session_completeness: "completed",
      reflection_confidence: "high",
      target_task_classification: {
        type: "documentation",
        domain: "hardening",
        complexity: "simple",
      },
      observed_work_classification: {
        type: "documentation",
        domain: "hardening",
        complexity: "simple",
      },
      approach: {
        strategy_summary: "Validated the stored reflection flow.",
        tool_sequence: ["read", "test"],
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
        evidence: "Checks passed.",
      },
      candidates_for_memory: [],
    },
    sessionID,
  )
}

function makeConsolidation(memoryContent: string, sessionID: string) {
  return consolidationFromJson(
    {
      themes: [],
      memory_entries: [
        {
          kind: "workflow",
          content: memoryContent,
          confidence: "high",
          scope: "generalizable",
          source_sessions: [sessionID],
        },
      ],
      synthesis_notes: null,
    },
    [makeReflection(sessionID)],
  )
}

describe("Phase 5 hardening", () => {
  describe("malformed stored reflection handling", () => {
    it("returns a structured error from opendream_dream_prompt when a stored reflection is malformed", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase5-dream-prompt-bad-reflection-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)
      await writeFile(join(config.stateDir, "reflections", "bad.json"), '{"session_id":"bad-session"}\n', "utf8")

      const tool = createOpencodeDreamPromptTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({})
      const result = JSON.parse(raw) as { error: string; reflectionFilePath?: string }

      expect(result.error).toMatch(/Invalid reflection file/i)
      expect(result.error).toMatch(/session_completeness/i)
      expect(result.reflectionFilePath).toContain("bad.json")
    })

    it("returns a structured error from opendream_dream_run before calling the model when a stored reflection is malformed", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase5-dream-run-bad-reflection-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)
      await writeFile(join(config.stateDir, "reflections", "bad.json"), '{"session_id":"bad-session"}\n', "utf8")

      const client = {
        session: {
          create: vi.fn(),
          prompt: vi.fn(),
          delete: vi.fn(),
        },
      } as never

      const tool = createOpencodeDreamRunTool(config, client) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({ modelOverride: "github-copilot/gpt-5.4" })
      const result = JSON.parse(raw) as { error: string; reflectionFilePath?: string }

      expect(result.error).toMatch(/Invalid reflection file/i)
      expect(result.error).toMatch(/session_completeness/i)
      expect(result.reflectionFilePath).toContain("bad.json")
      expect((client as { session: { create: ReturnType<typeof vi.fn> } }).session.create).not.toHaveBeenCalled()
    })
  })

  describe("memory to AGENTS cycle stability", () => {
    it("keeps a single managed AGENTS block across repeated memory-apply and export cycles", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase5-export-cycle-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)

      const firstPath = await writeDreamConsolidation(config.stateDir, makeConsolidation("first memory", "session-1"))
      const secondPath = await writeDreamConsolidation(config.stateDir, makeConsolidation("second memory", "session-2"))

      const applyTool = createOpencodeDreamMemoryApplyTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }
      const exportTool = createOpencodeDreamExportAgentsTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      await applyTool.execute({ consolidationFilePath: firstPath, mode: "append" })
      await exportTool.execute({})
      await applyTool.execute({ consolidationFilePath: secondPath, mode: "append" })
      await exportTool.execute({})

      const agents = await readFile(config.agentsFile, "utf8")

      expect(agents.match(/<!-- OPENCODE-DREAM:BEGIN -->/g)?.length ?? 0).toBe(1)
      expect(agents.match(/<!-- OPENCODE-DREAM:END -->/g)?.length ?? 0).toBe(1)
      expect(agents).toContain("first memory")
      expect(agents).toContain("second memory")
    })
  })
})
