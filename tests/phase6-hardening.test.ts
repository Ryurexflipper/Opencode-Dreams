import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { ensureDreamLayout, writeDreamReflection } from "../src/opendream/fs-store.js"
import { reflectionFromJson } from "../src/opendream/reflection.js"
import { createOpencodeDreamRunTool } from "../src/tools/opendream-dream-run.js"
import { createOpencodeDreamReflectImportJsonTool } from "../src/tools/opendream-reflect-import-json.js"
import { createOpencodeDreamMemoryApplyTool } from "../src/tools/opendream-memory-apply.js"
import { createOpencodeDreamExportAgentsTool } from "../src/tools/opendream-export-agents.js"

function makeStoredReflection(sessionID: string) {
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
        strategy_summary: "Validated the dream pipeline.",
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
      candidates_for_memory: [
        {
          kind: "workflow",
          content: `Remember ${sessionID}`,
          scope: "generalizable",
          evidence: "Seen during testing",
          confidence: "high",
        },
      ],
    },
    sessionID,
  )
}

function makeReflectionInput(memoryContent: string) {
  return {
    session_completeness: "completed",
    reflection_confidence: "high",
    target_task_classification: {
      type: "documentation",
      domain: "pipeline",
      complexity: "simple",
    },
    observed_work_classification: {
      type: "documentation",
      domain: "pipeline",
      complexity: "simple",
    },
    approach: {
      strategy_summary: "Validated the end-to-end pipeline.",
      tool_sequence: ["reflect_import_json", "dream_run", "memory_apply", "export_agents"],
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
      evidence: "Pipeline completed.",
    },
    candidates_for_memory: [
      {
        kind: "workflow",
        content: memoryContent,
        scope: "generalizable",
        evidence: "Observed in the imported reflection",
        confidence: "high",
      },
    ],
  }
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

function makeDreamClient(memoryContent: string, sessionID: string) {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: `dream-${sessionID}` } }),
      prompt: vi.fn().mockResolvedValue({
        data: {
          parts: [
            {
              type: "text",
              text: JSON.stringify({
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
              }),
            },
          ],
        },
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  }
}

describe("Phase 6 hardening", () => {
  describe("dream run malformed model output handling", () => {
    it("returns a structured error when the model returns parseable but invalid consolidation JSON", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase6-invalid-consolidation-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)
      await writeDreamReflection(config.stateDir, "session-invalid", makeStoredReflection("session-invalid"))

      const client = {
        session: {
          create: vi.fn().mockResolvedValue({ data: { id: "dream-invalid" } }),
          prompt: vi.fn().mockResolvedValue({
            data: {
              parts: [
                {
                  type: "text",
                  text: JSON.stringify({
                    themes: [],
                    memory_entries: [
                      {
                        kind: "workflow",
                        content: "   ",
                        confidence: "high",
                        scope: "generalizable",
                        source_sessions: ["session-invalid"],
                      },
                    ],
                    synthesis_notes: null,
                  }),
                },
              ],
            },
          }),
          delete: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as Parameters<typeof createOpencodeDreamRunTool>[1]

      const tool = createOpencodeDreamRunTool(config, client) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({ modelOverride: "github-copilot/gpt-5.4" })
      const result = JSON.parse(raw) as {
        error: string
        rawText?: string
        model?: { providerID: string; modelID: string }
      }

      expect(result.error).toMatch(/Invalid consolidation payload/i)
      expect(result.error).toMatch(/memory_entries\[0\]\.content/i)
      expect(result.rawText).toContain('"content":"   "')
      expect(result.model).toMatchObject({ providerID: "github-copilot", modelID: "gpt-5.4" })
      expect(client.session.delete).toHaveBeenCalledWith({ path: { id: "dream-invalid" } })
    })
  })

  describe("end-to-end pipeline stability", () => {
    it("keeps a single managed AGENTS block across repeated reflect-import to export cycles", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase6-e2e-cycle-"))
      const config = resolveDreamConfig(root, { preferredDreamModel: "github-copilot/gpt-5.4" })
      await ensureDreamLayout(config.stateDir)

      const reflectImportTool = createOpencodeDreamReflectImportJsonTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }
      const applyTool = createOpencodeDreamMemoryApplyTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }
      const exportTool = createOpencodeDreamExportAgentsTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const sessionAFile = await writeSessionFile(root, "session-a")
      const importedA = JSON.parse(
        await reflectImportTool.execute({
          sessionFilePath: sessionAFile,
          reflectionJson: JSON.stringify(makeReflectionInput("first imported memory")),
        }),
      ) as { sessionID: string; filePath: string }
      expect(importedA.sessionID).toBe("session-a")
      expect(importedA.filePath).toContain("session-a.json")

      const clientA = makeDreamClient("first imported memory", "session-a") as unknown as Parameters<
        typeof createOpencodeDreamRunTool
      >[1]
      const dreamRunA = createOpencodeDreamRunTool(config, clientA) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }
      const runA = JSON.parse(
        await dreamRunA.execute({
          modelOverride: "github-copilot/gpt-5.4",
          reflectionFilePaths: importedA.filePath,
        }),
      ) as { consolidationFilePath: string }

      await applyTool.execute({ consolidationFilePath: runA.consolidationFilePath, mode: "append" })
      await exportTool.execute({})

      const sessionBFile = await writeSessionFile(root, "session-b")
      const importedB = JSON.parse(
        await reflectImportTool.execute({
          sessionFilePath: sessionBFile,
          reflectionJson: JSON.stringify(makeReflectionInput("second imported memory")),
        }),
      ) as { sessionID: string; filePath: string }
      expect(importedB.sessionID).toBe("session-b")
      expect(importedB.filePath).toContain("session-b.json")

      const clientB = makeDreamClient("second imported memory", "session-b") as unknown as Parameters<
        typeof createOpencodeDreamRunTool
      >[1]
      const dreamRunB = createOpencodeDreamRunTool(config, clientB) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }
      const runB = JSON.parse(
        await dreamRunB.execute({
          modelOverride: "github-copilot/gpt-5.4",
          reflectionFilePaths: importedB.filePath,
        }),
      ) as { consolidationFilePath: string }

      await applyTool.execute({ consolidationFilePath: runB.consolidationFilePath, mode: "append" })
      await exportTool.execute({})

      const memory = await readFile(config.memoryFile, "utf8")
      const agents = await readFile(config.agentsFile, "utf8")

      expect(memory).toContain("first imported memory")
      expect(memory).toContain("second imported memory")
      expect(agents).toContain("first imported memory")
      expect(agents).toContain("second imported memory")
      expect(agents.match(/<!-- OPENCODE-DREAM:BEGIN -->/g)?.length ?? 0).toBe(1)
      expect(agents.match(/<!-- OPENCODE-DREAM:END -->/g)?.length ?? 0).toBe(1)
    })
  })
})
