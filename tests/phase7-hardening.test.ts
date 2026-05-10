import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { consolidationFromJson } from "../src/opendream/dream.js"
import { writeDreamConsolidation } from "../src/opendream/dream-store.js"
import { ensureDreamLayout } from "../src/opendream/fs-store.js"
import { reflectionFromJson } from "../src/opendream/reflection.js"
import { createOpencodeDreamExportAgentsTool } from "../src/tools/opendream-export-agents.js"
import { createOpencodeDreamMemoryApplyTool } from "../src/tools/opendream-memory-apply.js"
import { createOpencodeDreamReflectImportJsonTool } from "../src/tools/opendream-reflect-import-json.js"

function makeReflectionInput(memoryContent: string) {
  return {
    session_id: "payload-session-id",
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
      strategy_summary: "Validated the import boundary.",
      tool_sequence: ["reflect_import_json"],
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
      evidence: "Import succeeded.",
    },
    candidates_for_memory: [
      {
        kind: "workflow",
        content: memoryContent,
        scope: "generalizable",
        evidence: "Observed during import",
        confidence: "high",
      },
    ],
  }
}

function makeReflection(sessionID: string, memoryContent: string) {
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
        strategy_summary: "Validated apply/export behavior.",
        tool_sequence: ["memory_apply", "export_agents"],
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
      candidates_for_memory: [
        {
          kind: "workflow",
          content: memoryContent,
          scope: "generalizable",
          evidence: "Observed in testing",
          confidence: "high",
        },
      ],
    },
    sessionID,
  )
}

function makeConsolidation(sessionID: string, memoryContent: string) {
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
    [makeReflection(sessionID, memoryContent)],
  )
}

async function writeSessionFile(root: string, sessionName: string): Promise<string> {
  const sessionFile = join(root, `${sessionName}.jsonl`)
  await writeFile(
    sessionFile,
    `${JSON.stringify({
      agent: "build",
      started_at: "2026-05-10T00:00:00.000Z",
      task_description: `Session ${sessionName}`,
      messages: [{ index: 0, role: "user", content: `Run ${sessionName}` }],
    })}\n`,
    "utf8",
  )
  return sessionFile
}

describe("Phase 7 hardening", () => {
  describe("reflect import tool boundary", () => {
    it("returns a structured error when the session file has no rows", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase7-reflect-import-empty-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)

      const sessionFile = join(root, "empty-session.jsonl")
      await writeFile(sessionFile, "\n\n", "utf8")

      const tool = createOpencodeDreamReflectImportJsonTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({
        sessionFilePath: sessionFile,
        reflectionJson: JSON.stringify(makeReflectionInput("unused memory")),
      })
      const result = JSON.parse(raw) as { error: string; sessionFilePath?: string }

      expect(result.error).toMatch(/No session rows found/i)
      expect(result.sessionFilePath).toContain("empty-session.jsonl")
    })

    it("stores reflections under the resolved session id even when the payload session_id disagrees", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase7-reflect-import-mismatch-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)

      const sessionFile = await writeSessionFile(root, "resolved-from-path")
      const tool = createOpencodeDreamReflectImportJsonTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({
        sessionFilePath: sessionFile,
        reflectionJson: JSON.stringify(makeReflectionInput("path resolved memory")),
      })
      const result = JSON.parse(raw) as {
        sessionID: string
        filePath: string
        reflection: { session_id: string }
      }

      expect(result.sessionID).toBe("resolved-from-path")
      expect(result.filePath).toContain("resolved-from-path.json")
      expect(result.reflection.session_id).toBe("resolved-from-path")
    })
  })

  describe("multi-consolidation apply/export interactions", () => {
    it("keeps AGENTS in sync across append then replace then append cycles", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase7-apply-export-fuzz-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)

      const appendA = await writeDreamConsolidation(config.stateDir, makeConsolidation("session-a", "memory A"))
      const appendB = await writeDreamConsolidation(config.stateDir, makeConsolidation("session-b", "memory B"))
      const replaceC = await writeDreamConsolidation(config.stateDir, makeConsolidation("session-c", "memory C"))

      const applyTool = createOpencodeDreamMemoryApplyTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }
      const exportTool = createOpencodeDreamExportAgentsTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      await applyTool.execute({ consolidationFilePath: appendA, mode: "append" })
      await exportTool.execute({})
      await applyTool.execute({ consolidationFilePath: appendB, mode: "append" })
      await exportTool.execute({})
      await applyTool.execute({ consolidationFilePath: replaceC, mode: "replace" })
      await exportTool.execute({})
      await applyTool.execute({ consolidationFilePath: appendA, mode: "append" })
      await exportTool.execute({})

      const memory = await readFile(config.memoryFile, "utf8")
      const agents = await readFile(config.agentsFile, "utf8")

      expect(memory).toContain("memory C")
      expect(memory).toContain("memory A")
      expect(memory).not.toContain("memory B")

      expect(agents).toContain("memory C")
      expect(agents).toContain("memory A")
      expect(agents).not.toContain("memory B")
      expect(agents.match(/<!-- OPENCODE-DREAM:BEGIN -->/g)?.length ?? 0).toBe(1)
      expect(agents.match(/<!-- OPENCODE-DREAM:END -->/g)?.length ?? 0).toBe(1)
    })
  })
})
