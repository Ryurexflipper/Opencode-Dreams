import { tool } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { writeDreamReflection } from "../opendream/fs-store.js"
import { readGenericJsonlSessionFile } from "../opendream/generic-jsonl.js"
import { readReflectionJsonInput, reflectionFromJson, resolveDreamSessionID } from "../opendream/reflection.js"

export function createOpencodeDreamReflectImportJsonTool(config: DreamResolvedConfig) {
  return tool({
    description: "Validates externally supplied reflection JSON and stores it under .opencode-dream/reflections",
    args: {
      sessionFilePath: tool.schema.string().describe("Path to a saved session .jsonl file"),
      reflectionJson: tool.schema.string().optional().describe("Raw reflection JSON string to validate and store"),
      reflectionFilePath: tool.schema.string().optional().describe("Path to a reflection JSON file to validate and store"),
    },
    async execute(args) {
      try {
        const session = await readGenericJsonlSessionFile(args.sessionFilePath)
        const sessionID = resolveDreamSessionID(session, args.sessionFilePath)
        const raw = await readReflectionJsonInput({
          reflectionJson: args.reflectionJson,
          reflectionFilePath: args.reflectionFilePath,
        })
        const reflection = reflectionFromJson(raw, sessionID)
        const filePath = await writeDreamReflection(config.stateDir, sessionID, reflection)

        return JSON.stringify(
          {
            sessionID,
            filePath,
            reflection,
          },
          null,
          2,
        )
      } catch (error) {
        return JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error),
            sessionFilePath: args.sessionFilePath,
            reflectionFilePath: args.reflectionFilePath,
          },
          null,
          2,
        )
      }
    },
  })
}
