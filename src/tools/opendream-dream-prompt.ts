import { tool } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { readCurrentMemory } from "../opendream/fs-store.js"
import { listReflectionFiles } from "../opendream/dream-store.js"
import { renderDreamConsolidationPrompt } from "../opendream/dream.js"
import { readReflectionFile } from "../opendream/dream.js"

export function createOpencodeDreamPromptTool(config: DreamResolvedConfig) {
  return tool({
    description:
      "Stage 2 dry-run: renders the dream consolidation prompt without executing it. Shows exactly what would be sent to the model. Useful for inspection before running opendream_dream_run.",
    args: {
      reflectionFilePaths: tool.schema
        .string()
        .optional()
        .describe(
          "Comma-separated list of specific reflection file paths. Defaults to all in the reflections/ directory.",
        ),
    },
    async execute(args) {
      const filePaths: string[] = args.reflectionFilePaths
        ? args.reflectionFilePaths.split(",").map((s) => s.trim()).filter(Boolean)
        : await listReflectionFiles(config.stateDir)

      if (filePaths.length === 0) {
        return JSON.stringify(
          { error: "No reflection files found. Run opendream_reflect_run first.", stateDir: config.stateDir },
          null,
          2,
        )
      }

      const reflections = await Promise.all(filePaths.map((fp) => readReflectionFile(fp)))

      let existingMemory = ""
      try {
        existingMemory = await readCurrentMemory(config.stateDir)
      } catch {
        // memory may not exist yet
      }

      const prompt = renderDreamConsolidationPrompt(reflections, existingMemory)

      return JSON.stringify(
        {
          reflectionCount: reflections.length,
          reflectionFiles: filePaths,
          system: prompt.system,
          user: prompt.user,
          userLength: prompt.user.length,
        },
        null,
        2,
      )
    },
  })
}
