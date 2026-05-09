import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { logDreamEvent } from "../logger.js"
import { ensureDreamLayout } from "../opendream/fs-store.js"
import { processDreamEventCapture } from "../opendream/live-capture.js"

export function createDreamEventHook(
  config: DreamResolvedConfig,
  client: PluginInput["client"],
): NonNullable<Hooks["event"]> {
  return async ({ event }) => {
    if (!config.captureLiveSessions) return

    try {
      await ensureDreamLayout(config.stateDir)
      const result = await processDreamEventCapture(config, event)
      if (!result || !result.filePath) return
      await logDreamEvent(client, "debug", "Captured live session snapshot", result)
    } catch (error) {
      await logDreamEvent(client, "warn", "Failed to capture OpenCode session event", {
        eventType: event.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
