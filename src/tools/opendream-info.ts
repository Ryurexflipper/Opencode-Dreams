import { tool } from "@opencode-ai/plugin"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

import type { DreamResolvedConfig } from "../config.js"
import { readDreamEnvironment } from "../env.js"

async function countFiles(dir: string, ext: string): Promise<number> {
  try {
    const entries = await readdir(dir)
    return entries.filter((e) => e.endsWith(ext)).length
  } catch {
    return 0
  }
}

async function listSessionFiles(root: string): Promise<{ imports: string[]; live: string[]; runtime: string[] }> {
  async function list(dir: string): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((e) => e.endsWith(".jsonl"))
    } catch {
      return []
    }
  }
  return {
    imports: await list(join(root, "sessions", "imports")),
    live: await list(join(root, "sessions", "live")),
    runtime: await list(join(root, "sessions", "runtime")),
  }
}

export function createOpencodeDreamInfoTool(config: DreamResolvedConfig) {
  return tool({
    description: "Shows Opencode-Dream configuration, tool inventory, and reflection/dream pipeline status",
    args: {},
    async execute() {
      const env = readDreamEnvironment()

      // Gather pipeline status
      const reflectionCount = await countFiles(join(config.stateDir, "reflections"), ".json")
      const dreamCount = await countFiles(join(config.stateDir, "dreams"), ".json")
      const sessions = await listSessionFiles(config.stateDir)
      const totalSessionFiles = sessions.imports.length + sessions.live.length + sessions.runtime.length
      const processedByReflection = new Set<string>()
      try {
        const refs = await readdir(join(config.stateDir, "reflections"))
        for (const r of refs) {
          if (r.endsWith(".json")) processedByReflection.add(r.replace(/\.json$/, ""))
        }
      } catch { /* ok */ }

      const unprocessedSessions = [...sessions.imports, ...sessions.live].filter(
        (name) => !processedByReflection.has(name.replace(/\.jsonl$/, "")),
      )

      return JSON.stringify(
        {
          plugin: {
            id: config.pluginId,
            name: config.pluginName,
            stateDir: config.stateDir,
            memoryFile: config.memoryFile,
            agentsFile: config.agentsFile,
            reflectionDir: config.reflectionDir,
          },
          models: {
            preferredReflectModel: config.preferredReflectModel ?? env.reflectModel ?? null,
            preferredDreamModel: config.preferredDreamModel ?? env.dreamModel ?? null,
          },
          pipelineStatus: {
            totalSessionFiles,
            sessions: {
              imports: sessions.imports.length,
              live: sessions.live.length,
              runtime: sessions.runtime.length,
            },
            reflections: reflectionCount,
            unprocessedSessionsNeedingReflection: unprocessedSessions.length,
            dreams: dreamCount,
          },
          tools: {
            init: "opendream_init — create .opencode-dream/ layout",
            info: "opendream_info — this tool",
            memoryStatus: "opendream_memory_status — summarize state directory",
            ingestJsonl: "opendream_ingest_generic_jsonl — import a JSONL session file",
            reflectPrompt: "opendream_reflect_prompt — dry-run Stage 1 prompt (no LLM)",
            reflectImportJson: "opendream_reflect_import_json — store manually crafted reflection JSON",
            reflectRun: "opendream_reflect_run — Stage 1: reflect on a single session via LLM",
            reflectBatch: "opendream_reflect_batch — Stage 1 batch: reflect on all unprocessed sessions",
            dreamPrompt: "opendream_dream_prompt — dry-run Stage 2 consolidation prompt (no LLM)",
            dreamRun: "opendream_dream_run — Stage 2: synthesize all reflections into a dream consolidation",
            memoryApply: "opendream_memory_apply — apply dream consolidation entries to memory/current.md",
            exportAgents: "opendream_export_agents — export memory section to AGENTS.md",
            memProbe: "opendream_mem_probe — check opencode-mem server status and preview memories",
            memSync: "opendream_mem_sync — import opencode-mem memories into memory/current.md",
          },
          integrations: {
            opencodeMem: {
              enabled: config.opencodeMem.enabled,
              url: config.opencodeMem.url,
              importMode: config.opencodeMem.importMode,
              hint: config.opencodeMem.enabled
                ? "Run opendream_mem_probe to check connectivity, opendream_mem_sync to import"
                : 'Disabled. Set opencodeMem.enabled = true in opencode.json to activate',
            },
          },
          recommendedWorkflow: [
            "0. opendream_mem_sync — (optional) import opencode-mem memories first",
            "1. opendream_init — set up state dir",
            "2. opendream_ingest_generic_jsonl — import session files (or live capture auto-runs)",
            "3. opendream_reflect_batch — run Stage 1 on all pending sessions",
            "4. opendream_dream_run — run Stage 2 consolidation",
            "5. opendream_memory_apply — apply entries to memory/current.md",
            "6. opendream_export_agents — push memory into AGENTS.md",
          ],
        },
        null,
        2,
      )
    },
  })
}
