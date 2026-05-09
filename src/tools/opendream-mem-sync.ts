import { tool } from "@opencode-ai/plugin"
import { readFile, writeFile } from "node:fs/promises"

import type { DreamResolvedConfig } from "../config.js"
import {
  fetchOpencodeMemItems,
  mergeOpencodeMemSection,
  renderOpencodeMemSection,
} from "../integrations/opencode-mem.js"

export function createOpencodeDreamMemSyncTool(config: DreamResolvedConfig) {
  return tool({
    description:
      "Reads all memories from the opencode-mem server and injects them into memory/current.md. " +
      "Requires opencodeMem.enabled = true in your opencode.json plugin config. " +
      "Use this to import external memories (errors fixed, preferences, project context) so agents always have full context. " +
      "Run at the start of a session or after opendream_dream_run to keep memories in sync.",
    args: {
      url: tool.schema
        .string()
        .optional()
        .describe(
          "Override the opencode-mem server URL (e.g. 'http://127.0.0.1:4747'). Defaults to the configured url.",
        ),
      mode: tool.schema
        .enum(["append", "replace"])
        .optional()
        .describe(
          '"append" (default) replaces the existing opencode-mem block or appends if absent. ' +
            '"replace" rebuilds the entire memory file from the imported memories.',
        ),
      maxItemLength: tool.schema
        .number()
        .optional()
        .describe("Max characters per memory item to include (default: from config, usually 1000)."),
      dryRun: tool.schema
        .boolean()
        .optional()
        .describe("If true, returns the preview of what would be written without making changes."),
      filter: tool.schema
        .string()
        .optional()
        .describe(
          "Optional text filter — only include memory items whose content contains this string (case-insensitive).",
        ),
    },
    async execute(args) {
      // Respect enabled flag unless an explicit URL override is provided
      if (!config.opencodeMem.enabled && !args.url) {
        return JSON.stringify(
          {
            error:
              "opencode-mem integration is disabled. " +
              'Set opencodeMem.enabled = true in your opencode.json plugin options, or pass a "url" argument to override.',
            hint: 'Example config: { "opencodeMem": { "enabled": true, "url": "http://127.0.0.1:4747" } }',
          },
          null,
          2,
        )
      }

      const url = args.url ?? config.opencodeMem.url
      const mode = (args.mode as "append" | "replace") ?? config.opencodeMem.importMode
      const maxItemLength = args.maxItemLength ?? config.opencodeMem.maxItemLength

      // Fetch memories
      const result = await fetchOpencodeMemItems(url)
      if (!result.ok) {
        return JSON.stringify(
          {
            error: "Failed to fetch memories from opencode-mem",
            url,
            reason: result.reason,
            hint: "Make sure the opencode-mem server is running and accessible.",
          },
          null,
          2,
        )
      }

      let items = result.items

      // Apply text filter if requested
      if (args.filter) {
        const needle = args.filter.toLowerCase()
        items = items.filter((item) => item.content.toLowerCase().includes(needle))
      }

      if (items.length === 0) {
        return JSON.stringify(
          {
            warning: "opencode-mem returned 0 items" + (args.filter ? ` matching filter "${args.filter}"` : ""),
            url,
            totalFetched: result.items.length,
          },
          null,
          2,
        )
      }

      // Render the markdown section
      const section = renderOpencodeMemSection(items, { maxItemLength, sourceUrl: url })

      // Read existing memory file
      let existingContent = ""
      try {
        existingContent = await readFile(config.memoryFile, "utf8")
      } catch {
        // file may not exist yet — that's fine
      }

      const updated = mergeOpencodeMemSection(existingContent, section, mode)

      if (args.dryRun) {
        return JSON.stringify(
          {
            dryRun: true,
            url,
            memoryFilePath: config.memoryFile,
            mode,
            totalFetched: result.items.length,
            itemsIncluded: items.length,
            filteredOut: result.items.length - items.length,
            previewContent: updated,
          },
          null,
          2,
        )
      }

      await writeFile(config.memoryFile, updated, "utf8")

      return JSON.stringify(
        {
          ok: true,
          url,
          memoryFilePath: config.memoryFile,
          mode,
          totalFetched: result.items.length,
          itemsIncluded: items.length,
          filteredOut: result.items.length - items.length,
          message: `Successfully synced ${items.length} memory item(s) into ${config.memoryFile}`,
        },
        null,
        2,
      )
    },
  })
}
