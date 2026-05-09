import { tool } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { exportDreamManagedSection } from "../opendream/agents-md.js"
import { ensureDreamLayout, readCurrentMemory } from "../opendream/fs-store.js"

export function createOpencodeDreamInitTool(config: DreamResolvedConfig) {
  return tool({
    description: "Initializes the Opencode-Dream workspace layout and optional AGENTS.md markers",
    args: {
      initializeAgentsFile: tool.schema.boolean().optional().describe("Also create or update AGENTS.md markers")
    },
    async execute(args) {
      const layout = await ensureDreamLayout(config.stateDir)
      let agentsResult: Record<string, unknown> | null = null
      if (args.initializeAgentsFile) {
        const memory = await readCurrentMemory(config.stateDir)
        agentsResult = await exportDreamManagedSection(config.agentsFile, memory)
      }
      return JSON.stringify({ layout, agents: agentsResult }, null, 2)
    },
  })
}
