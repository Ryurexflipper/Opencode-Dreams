import { readFile } from "node:fs/promises"

import { tool } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { buildDreamManagedBlock, exportDreamManagedSection, findDreamManagedBlockBounds } from "../opendream/agents-md.js"
import { readCurrentMemory } from "../opendream/fs-store.js"

async function buildPreview(
  agentsFile: string,
  memoryMarkdown: string,
): Promise<{ action: "create" | "replace" | "append"; currentLength: number; previewFragment: string }> {
  const block = buildDreamManagedBlock(memoryMarkdown)

  let existing = ""
  try {
    existing = await readFile(agentsFile, "utf8")
  } catch {
    return { action: "create", currentLength: 0, previewFragment: block.slice(0, 500) }
  }

  if (findDreamManagedBlockBounds(existing)) {
    return { action: "replace", currentLength: existing.length, previewFragment: block.slice(0, 500) }
  }
  return { action: "append", currentLength: existing.length, previewFragment: block.slice(0, 500) }
}

export function createOpencodeDreamExportAgentsTool(config: DreamResolvedConfig) {
  return tool({
    description:
      "Exports the current Opencode-Dream memory into AGENTS.md managed markers. Use dryRun=true to preview what would be written without making any changes.",
    args: {
      filePath: tool.schema
        .string()
        .optional()
        .describe("Optional custom AGENTS.md target path. Defaults to project AGENTS.md."),
      dryRun: tool.schema
        .boolean()
        .optional()
        .describe(
          "If true, returns a preview of what would be written without modifying any files. Default false.",
        ),
    },
    async execute(args) {
      const targetFile = args.filePath ?? config.agentsFile
      const memory = await readCurrentMemory(config.stateDir)

      if (args.dryRun) {
        const preview = await buildPreview(targetFile, memory)
        return JSON.stringify(
          {
            dryRun: true,
            agentsFile: targetFile,
            wouldAction: preview.action,
            currentFileLength: preview.currentLength,
            previewFragment: preview.previewFragment,
            note: "No files were modified. Set dryRun=false (or omit) to apply.",
          },
          null,
          2,
        )
      }

      const result = await exportDreamManagedSection(targetFile, memory)
      return JSON.stringify(result, null, 2)
    },
  })
}
