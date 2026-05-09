import type { Hooks } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"

export function createDreamShellEnvHook(config: DreamResolvedConfig): NonNullable<Hooks["shell.env"]> {
  return async (_input, output) => {
    output.env.OPENCODE_DREAM_ROOT = config.stateDir
    output.env.OPENCODE_DREAM_MEMORY_FILE = config.memoryFile
    output.env.OPENCODE_DREAM_AGENTS_FILE = config.agentsFile
    if (config.preferredReflectModel) output.env.OPENCODE_DREAM_REFLECT_MODEL = config.preferredReflectModel
    if (config.preferredDreamModel) output.env.OPENCODE_DREAM_DREAM_MODEL = config.preferredDreamModel
  }
}
