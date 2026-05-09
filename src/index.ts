import type { Plugin, PluginModule } from "@opencode-ai/plugin"

import { resolveDreamConfig } from "./config.js"
import { createDreamCompactionHook } from "./hooks/compaction.js"
import { createDreamShellEnvHook } from "./hooks/env.js"
import { createDreamEventHook } from "./hooks/event.js"
import { logDreamEvent } from "./logger.js"
import { createOpencodeDreamExportAgentsTool } from "./tools/opendream-export-agents.js"
import { createOpencodeDreamInfoTool } from "./tools/opendream-info.js"
import { createOpencodeDreamInitTool } from "./tools/opendream-init.js"
import { createOpencodeDreamIngestGenericJsonlTool } from "./tools/opendream-ingest-generic-jsonl.js"
import { createOpencodeDreamMemoryStatusTool } from "./tools/opendream-memory-status.js"
import { createOpencodeDreamReflectImportJsonTool } from "./tools/opendream-reflect-import-json.js"
import { createOpencodeDreamReflectPromptTool } from "./tools/opendream-reflect-prompt.js"
import { createOpencodeDreamReflectRunTool } from "./tools/opendream-reflect-run.js"
import { createOpencodeDreamReflectBatchTool } from "./tools/opendream-reflect-batch.js"
import { createOpencodeDreamRunTool } from "./tools/opendream-dream-run.js"
import { createOpencodeDreamPromptTool } from "./tools/opendream-dream-prompt.js"
import { createOpencodeDreamMemoryApplyTool } from "./tools/opendream-memory-apply.js"
import { createOpencodeDreamMemSyncTool } from "./tools/opendream-mem-sync.js"
import { createOpencodeDreamMemStatusTool } from "./tools/opendream-mem-probe.js"
import { createOpendreamExtMemSyncTool } from "./tools/opendream-ext-mem-sync.js"

export const OpencodeDreamServer: Plugin = async (input, options) => {
  const config = resolveDreamConfig(input.directory, options)

  await logDreamEvent(input.client, "info", "Plugin initialized", {
    directory: input.directory,
    worktree: input.worktree,
    stateDir: config.stateDir,
    agentsFile: config.agentsFile,
  })

  return {
    tool: {
      opendream_info: createOpencodeDreamInfoTool(config),
      opendream_init: createOpencodeDreamInitTool(config),
      opendream_memory_status: createOpencodeDreamMemoryStatusTool(config),
      opendream_export_agents: createOpencodeDreamExportAgentsTool(config),
      opendream_ingest_generic_jsonl: createOpencodeDreamIngestGenericJsonlTool(config),
      opendream_reflect_prompt: createOpencodeDreamReflectPromptTool(),
      opendream_reflect_import_json: createOpencodeDreamReflectImportJsonTool(config),
      opendream_reflect_run: createOpencodeDreamReflectRunTool(config, input.client),
      opendream_reflect_batch: createOpencodeDreamReflectBatchTool(config, input.client),
      opendream_dream_prompt: createOpencodeDreamPromptTool(config),
      opendream_dream_run: createOpencodeDreamRunTool(config, input.client),
      opendream_memory_apply: createOpencodeDreamMemoryApplyTool(config),
      opendream_mem_sync: createOpencodeDreamMemSyncTool(config),
      opendream_mem_probe: createOpencodeDreamMemStatusTool(config),
      opendream_ext_mem_sync: createOpendreamExtMemSyncTool(config),
    },
    event: createDreamEventHook(config, input.client),
    "shell.env": createDreamShellEnvHook(config),
    "experimental.session.compacting": createDreamCompactionHook(config),
  }
}

const id = "opencode-dream" as const

const pluginModule: PluginModule = {
  id,
  server: OpencodeDreamServer,
}

export default pluginModule
