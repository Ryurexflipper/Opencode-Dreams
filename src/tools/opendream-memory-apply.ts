import { tool } from "@opencode-ai/plugin"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { DreamResolvedConfig } from "../config.js"
import { listDreamConsolidations } from "../opendream/dream-store.js"
import type { DreamConsolidation, DreamMemoryEntry } from "../opendream/dream.js"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function formatMemorySection(entries: DreamMemoryEntry[]): string {
  if (entries.length === 0) return ""

  const byKind: Record<string, DreamMemoryEntry[]> = {}
  for (const entry of entries) {
    if (!byKind[entry.kind]) byKind[entry.kind] = []
    byKind[entry.kind]!.push(entry)
  }

  const sections: string[] = []
  const kindOrder = ["workflow", "pattern", "preference", "fact", "failure_mode"] as const
  for (const kind of kindOrder) {
    const kindEntries = byKind[kind]
    if (!kindEntries || kindEntries.length === 0) continue
    sections.push(`### ${kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ")}`)
    for (const entry of kindEntries) {
      const scopeTag = entry.scope === "generalizable" ? "" : " *(task-specific)*"
      const confTag = entry.confidence === "low" ? " *(low confidence)*" : ""
      sections.push(`- ${entry.content}${scopeTag}${confTag}`)
    }
    sections.push("")
  }
  return sections.join("\n")
}

function buildMemoryMarkdown(
  existingContent: string,
  consolidation: DreamConsolidation,
  mode: "append" | "replace",
): string {
  const timestamp = new Date().toISOString()
  const header = [
    `## Opencode-Dream consolidated memory`,
    ``,
    `_Last updated: ${timestamp} — ${consolidation.session_count} session(s) consolidated_`,
    ``,
  ].join("\n")

  const newSection = [
    `<!-- dream:${consolidation.id} -->`,
    formatMemorySection(consolidation.memory_entries),
    `<!-- /dream:${consolidation.id} -->`,
  ].join("\n")

  if (mode === "replace") {
    return `${header}\n${newSection}\n`
  }

  // Append mode: strip any existing dream block with the same id if present, then append
  const stripped = existingContent.replace(
    new RegExp(`<!-- dream:${consolidation.id} -->[\\s\\S]*?<!-- /dream:${consolidation.id} -->\\n?`, "g"),
    "",
  )
  return `${stripped.trimEnd()}\n\n${newSection}\n`
}

export function createOpencodeDreamMemoryApplyTool(config: DreamResolvedConfig) {
  return tool({
    description:
      "Applies the memory entries from the most recent dream consolidation into memory/current.md. Can append to or replace the existing memory file. Run after opendream_dream_run to commit the synthesized knowledge.",
    args: {
      consolidationFilePath: tool.schema
        .string()
        .optional()
        .describe(
          "Path to a specific consolidation JSON file. Defaults to the most recent consolidation in the dreams/ directory.",
        ),
      mode: tool.schema
        .enum(["append", "replace"])
        .optional()
        .describe(
          '"append" (default) adds new entries while preserving existing content. "replace" rebuilds the file from the consolidation only.',
        ),
      dryRun: tool.schema
        .boolean()
        .optional()
        .describe("If true, shows the updated memory content without writing it."),
    },
    async execute(args) {
      const mode = (args.mode as "append" | "replace") ?? "append"

      // Resolve consolidation file
      let consolidationPath = args.consolidationFilePath
      if (!consolidationPath) {
        const files = await listDreamConsolidations(config.stateDir)
        if (files.length === 0) {
          return JSON.stringify(
            {
              error: "No consolidation files found. Run opendream_dream_run first.",
              stateDir: config.stateDir,
            },
            null,
            2,
          )
        }
        // Sort lexicographically (UUIDs are random but we list by mtime implicitly)
        consolidationPath = files[files.length - 1]!
      }

      const raw = await readFile(consolidationPath, "utf8")
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed)) {
        return JSON.stringify({ error: "Consolidation file is not a valid JSON object" }, null, 2)
      }
      const consolidation = parsed as unknown as DreamConsolidation

      // Read existing memory
      let existingContent = ""
      try {
        existingContent = await readFile(config.memoryFile, "utf8")
      } catch {
        // file doesn't exist yet
      }

      const updated = buildMemoryMarkdown(existingContent, consolidation, mode)

      if (args.dryRun) {
        return JSON.stringify(
          {
            dryRun: true,
            consolidationFilePath: consolidationPath,
            memoryFilePath: config.memoryFile,
            mode,
            memoryEntryCount: consolidation.memory_entries.length,
            previewContent: updated,
          },
          null,
          2,
        )
      }

      await writeFile(config.memoryFile, updated, "utf8")

      return JSON.stringify(
        {
          consolidationFilePath: consolidationPath,
          memoryFilePath: config.memoryFile,
          mode,
          memoryEntryCount: consolidation.memory_entries.length,
          themeCount: consolidation.themes.length,
          applied: true,
        },
        null,
        2,
      )
    },
  })
}
