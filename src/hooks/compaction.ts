import type { Hooks } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { readCurrentMemory } from "../opendream/fs-store.js"

export function createDreamCompactionHook(
  config: DreamResolvedConfig,
): NonNullable<Hooks["experimental.session.compacting"]> {
  return async (_input, output) => {
    try {
      const memory = (await readCurrentMemory(config.stateDir)).trim()
      if (!memory) return
      output.context.push(`## Opencode-Dream consolidated memory\n\n${memory}`)
    } catch {
      // Fresh state is expected until initialization.
    }
  }
}
