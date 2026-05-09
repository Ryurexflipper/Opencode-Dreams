import { tool } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { fetchOpencodeMemItems } from "../integrations/opencode-mem.js"

export function createOpencodeDreamMemStatusTool(config: DreamResolvedConfig) {
  return tool({
    description:
      "Checks whether the opencode-mem server is reachable and shows a preview of stored memories. " +
      "Use this to verify the integration is working and to see what memories are available before syncing. " +
      "Works even when opencodeMem.enabled = false — useful for diagnostics.",
    args: {
      url: tool.schema
        .string()
        .optional()
        .describe(
          "Override the opencode-mem server URL to check. Defaults to the configured url (http://127.0.0.1:4747).",
        ),
      showFull: tool.schema
        .boolean()
        .optional()
        .describe("If true, returns the full content of each memory item instead of a 200-char preview."),
    },
    async execute(args) {
      const url = args.url ?? config.opencodeMem.url
      const previewLen = args.showFull ? Infinity : 200

      const result = await fetchOpencodeMemItems(url)

      if (!result.ok) {
        return JSON.stringify(
          {
            reachable: false,
            enabled: config.opencodeMem.enabled,
            url,
            reason: result.reason,
            hint: [
              "Make sure the opencode-mem npm package is installed and the server is running.",
              "Start it with: npx opencode-mem (or however your setup starts it)",
              `Expected endpoint: ${url}/api/memories`,
            ],
          },
          null,
          2,
        )
      }

      const preview = result.items.map((item) => ({
        id: item.id,
        type: item.type,
        contentPreview:
          item.content.length > previewLen ? item.content.slice(0, previewLen) + "…" : item.content,
        length: item.content.length,
      }))

      return JSON.stringify(
        {
          reachable: true,
          enabled: config.opencodeMem.enabled,
          url,
          totalItems: result.items.length,
          configuredImportMode: config.opencodeMem.importMode,
          configuredMaxItemLength: config.opencodeMem.maxItemLength,
          items: preview,
          hint: config.opencodeMem.enabled
            ? 'Run opendream_mem_sync to import these memories into memory/current.md'
            : 'Integration is disabled. Set opencodeMem.enabled = true in your opencode.json to enable sync.',
        },
        null,
        2,
      )
    },
  })
}
