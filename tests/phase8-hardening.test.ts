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
        strategy_summary: "Validated same-id behavior.",
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

async function writeSessionFile(root: string, sessionName: string, sessionOverride?: Record<string, unknown>): Promise<string> {
  const sessionFile = join(root, `${sessionName}.jsonl`)
  const base = {
    agent: "build",
    started_at: "2026-05-10T00:00:00.000Z",
    task_description: `Session ${sessionName}`,
    messages: [{ index: 0, role: "user", content: `Run ${sessionName}` }],
  }
  await writeFile(sessionFile, `${JSON.stringify({ ...base, ...sessionOverride })}\n`, "utf8")
  return sessionFile
}

describe("Phase 8 hardening", () => {
  describe("reflect import ambiguity and invalid-session handling", () => {
    it("returns a structured error when both reflectionJson and reflectionFilePath are provided", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase8-reflect-import-both-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)

      const sessionFile = await writeSessionFile(root, "both-inputs")
      const reflectionFile = join(root, "reflection.json")
      await writeFile(reflectionFile, `${JSON.stringify(makeReflectionInput("from file"))}\n`, "utf8")

      const tool = createOpencodeDreamReflectImportJsonTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({
        sessionFilePath: sessionFile,
        reflectionJson: JSON.stringify(makeReflectionInput("from inline json")),
        reflectionFilePath: reflectionFile,
      })
      const result = JSON.parse(raw) as {
        error: string
        sessionFilePath?: string
        reflectionFilePath?: string
      }

      expect(result.error).toMatch(/either reflectionJson or reflectionFilePath/i)
      expect(result.sessionFilePath).toContain("both-inputs.jsonl")
      expect(result.reflectionFilePath).toContain("reflection.json")
    })

    it("returns a structured error when the session file shape is invalid", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase8-reflect-import-invalid-session-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)

      const sessionFile = await writeSessionFile(root, "invalid-session", { messages: [] })
      const tool = createOpencodeDreamReflectImportJsonTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({
        sessionFilePath: sessionFile,
        reflectionJson: JSON.stringify(makeReflectionInput("unused memory")),
      })
      const result = JSON.parse(raw) as { error: string; sessionFilePath?: string }

      expect(result.error).toMatch(/messages/i)
      expect(result.error).toMatch(/non-empty array/i)
      expect(result.sessionFilePath).toContain("invalid-session.jsonl")
    })
  })

  describe("same-id and preview parity fuzzing", () => {
    it("replaces same-id memory content during append and keeps export preview aligned", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase8-same-id-preview-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)

      const consolidationA = makeConsolidation("session-same", "memory old")
      const consolidationB = {
        ...makeConsolidation("session-same", "memory new"),
        id: consolidationA.id,
      }

      const fileA = await writeDreamConsolidation(config.stateDir, consolidationA)
      const fileB = await writeDreamConsolidation(config.stateDir, consolidationB)

      const applyTool = createOpencodeDreamMemoryApplyTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }
      const exportTool = createOpencodeDreamExportAgentsTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      await applyTool.execute({ consolidationFilePath: fileA, mode: "append" })
      await exportTool.execute({})
      await applyTool.execute({ consolidationFilePath: fileB, mode: "append" })

      const preview = JSON.parse(await exportTool.execute({ dryRun: true })) as {
        wouldAction: string
        previewFragment: string
      }

      expect(preview.wouldAction).toBe("replace")
      expect(preview.previewFragment).toContain("memory new")
      expect(preview.previewFragment).not.toContain("memory old")

      await exportTool.execute({})

      const memory = await readFile(config.memoryFile, "utf8")
      const agents = await readFile(config.agentsFile, "utf8")

      expect(memory).toContain("memory new")
      expect(memory).not.toContain("memory old")
      expect(memory.split(`<!-- dream:${consolidationA.id} -->`).length - 1).toBe(1)
      expect(memory.split(`<!-- /dream:${consolidationA.id} -->`).length - 1).toBe(1)

      expect(agents).toContain("memory new")
      expect(agents).not.toContain("memory old")
      expect(agents.match(/<!-- OPENCODE-DREAM:BEGIN -->/g)?.length ?? 0).toBe(1)
      expect(agents.match(/<!-- OPENCODE-DREAM:END -->/g)?.length ?? 0).toBe(1)
    })
  })
})
