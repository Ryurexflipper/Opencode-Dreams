import { access } from "node:fs/promises"

import { tool } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { summarizeDreamState } from "../opendream/fs-store.js"

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function createOpencodeDreamMemoryStatusTool(config: DreamResolvedConfig) {
  return tool({
    description: "Shows Opencode-Dream filesystem and memory status",
    args: {},
    async execute() {
      const summary = await summarizeDreamState(config.stateDir)
      return JSON.stringify(
        {
          ...summary,
          agentsFile: config.agentsFile,
          agentsFileExists: await exists(config.agentsFile)
        },
        null,
        2,
      )
    },
  })
}
