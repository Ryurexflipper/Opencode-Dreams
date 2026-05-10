import { tool } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { importFileIntoDreamSessions } from "../opendream/fs-store.js"
import { validateGenericJsonlFile } from "../opendream/generic-jsonl.js"

export function createOpencodeDreamIngestGenericJsonlTool(config: DreamResolvedConfig) {
  return tool({
    description: "Validates and stages a generic JSONL session export using the OpenDream adapter shape",
    args: {
      filePath: tool.schema.string().describe("Path to a generic JSONL file to validate and stage"),
      copyIntoStateDir: tool.schema.boolean().optional().describe("Copy the validated file into .opencode-dream/sessions/imports")
    },
    async execute(args) {
      const validation = await validateGenericJsonlFile(args.filePath)
      const shouldCopy = Boolean(args.copyIntoStateDir) && validation.invalidLines === 0 && validation.validLines > 0
      const copiedTo = shouldCopy ? await importFileIntoDreamSessions(config.stateDir, args.filePath) : null

      return JSON.stringify(
        {
          validation,
          copiedTo,
          notes: [
            "This validates OpenDream-style generic_jsonl structure only.",
            "It does not yet create Stage 1 reflections or Stage 2 dreams.",
            ...(args.copyIntoStateDir && !shouldCopy
              ? ["File was not copied into state because validation did not produce at least one valid line with zero invalid lines."]
              : []),
          ]
        },
        null,
        2,
      )
    },
  })
}
