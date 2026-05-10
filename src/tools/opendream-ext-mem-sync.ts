/**
 * opendream_ext_mem_sync — Unified external memory sync tool
 *
 * Single tool to pull from ANY or ALL supported external memory sources:
 *   - opencode-mem (HTTP, :4747)
 *   - true-mem (SQLite, ~/.true-mem/memory.db)
 *   - simple-memory (logfmt, .opencode/memory/)
 *   - opencode-lcm (SQLite, .lcm/lcm.db)
 *
 * Each source is toggled independently. Results are merged into memory/current.md.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { tool } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { fetchOpencodeMemItems, mergeOpencodeMemSection, renderOpencodeMemSection } from "../integrations/opencode-mem.js"
import { fetchTrueMemItems, mergeTrueMemSection, renderTrueMemSection } from "../integrations/true-mem.js"
import {
  defaultSimpleMemoryDir,
  fetchSimpleMemoryItems,
  mergeSimpleMemorySection,
  renderSimpleMemorySection,
} from "../integrations/simple-memory.js"
import {
  defaultLcmDbPath,
  fetchLcmItems,
  mergeLcmSection,
  renderLcmSection,
} from "../integrations/opencode-lcm.js"

export function createOpendreamExtMemSyncTool(config: DreamResolvedConfig) {
  return tool({
    description:
      "Syncs memories from ALL supported external memory plugins into memory/current.md. " +
      "Supports: opencode-mem (HTTP), true-mem (SQLite ~/.true-mem/memory.db), " +
      "simple-memory (logfmt .opencode/memory/), and opencode-lcm (SQLite .lcm/lcm.db). " +
      "Each source can be individually enabled/disabled. " +
      "Use this as the single command to pull all external context into the dream pipeline.",
    args: {
      sources: tool.schema
        .array(
          tool.schema.enum(["opencode-mem", "true-mem", "simple-memory", "opencode-lcm"] as const),
        )
        .optional()
        .describe(
          "Which sources to sync. Defaults to all sources. " +
            "Example: [\"opencode-mem\", \"true-mem\"] to sync only those two.",
        ),
      dryRun: tool.schema
        .boolean()
        .optional()
        .describe("If true, returns the merged content preview without writing to disk."),
      mode: tool.schema
        .enum(["append", "replace"] as const)
        .optional()
        .describe(
          "How to write each source's block: " +
            "append = replace existing block or add at end (default); " +
            "replace = rewrite entire memory file with just this source.",
        ),
      maxItemLength: tool.schema
        .number()
        .optional()
        .describe("Max characters per item. Defaults to 1000."),
      // Source-specific overrides
      opencodeMemUrl: tool.schema
        .string()
        .optional()
        .describe("Override opencode-mem server URL. Default: http://127.0.0.1:4747"),
      trueMemDbPath: tool.schema
        .string()
        .optional()
        .describe("Override true-mem database path. Default: ~/.true-mem/memory.db"),
      simpleMemoryDir: tool.schema
        .string()
        .optional()
        .describe("Override simple-memory directory. Default: .opencode/memory/ relative to project"),
      lcmDbPath: tool.schema
        .string()
        .optional()
        .describe("Override opencode-lcm database path. Default: .lcm/lcm.db relative to project"),
    },

    async execute(args) {
      const requestedSources = args.sources ?? ["opencode-mem", "true-mem", "simple-memory", "opencode-lcm"]
      const dryRun = args.dryRun ?? false
      const mode = args.mode ?? "append"
      const maxItemLength = args.maxItemLength ?? config.opencodeMem.maxItemLength

      const results: Record<string, unknown> = {}
      const sections: string[] = []

      // ── opencode-mem ────────────────────────────────────────────────────────
      if (requestedSources.includes("opencode-mem")) {
        const url = args.opencodeMemUrl ?? config.opencodeMem.url
        const fetchResult = await fetchOpencodeMemItems(url)
        if (!fetchResult.ok) {
          results["opencode-mem"] = { ok: false, reason: fetchResult.reason, url }
        } else {
          const section = renderOpencodeMemSection(fetchResult.items, { maxItemLength, sourceUrl: url })
          sections.push(section)
          results["opencode-mem"] = { ok: true, url, itemCount: fetchResult.items.length }
        }
      }

      // ── true-mem ─────────────────────────────────────────────────────────────
      if (requestedSources.includes("true-mem")) {
        const dbPath = args.trueMemDbPath
        const fetchResult = await fetchTrueMemItems(dbPath)
        if (!fetchResult.ok) {
          results["true-mem"] = { ok: false, reason: fetchResult.reason, dbPath: fetchResult.dbPath }
        } else {
          const section = renderTrueMemSection(fetchResult.items, {
            maxItemLength,
            dbPath: fetchResult.dbPath,
          })
          sections.push(section)
          results["true-mem"] = { ok: true, dbPath: fetchResult.dbPath, itemCount: fetchResult.items.length }
        }
      }

      // ── simple-memory ────────────────────────────────────────────────────────
      if (requestedSources.includes("simple-memory")) {
        const memDir = args.simpleMemoryDir ?? defaultSimpleMemoryDir(process.cwd())
        const fetchResult = await fetchSimpleMemoryItems(memDir)
        if (!fetchResult.ok) {
          results["simple-memory"] = { ok: false, reason: fetchResult.reason, directory: fetchResult.directory }
        } else {
          const section = renderSimpleMemorySection(fetchResult.items, {
            maxItemLength,
            directory: fetchResult.directory,
          })
          sections.push(section)
          results["simple-memory"] = {
            ok: true,
            directory: fetchResult.directory,
            fileCount: fetchResult.files.length,
            itemCount: fetchResult.items.length,
          }
        }
      }

      // ── opencode-lcm ─────────────────────────────────────────────────────────
      if (requestedSources.includes("opencode-lcm")) {
        const dbPath = args.lcmDbPath ?? defaultLcmDbPath(process.cwd())
        const fetchResult = await fetchLcmItems(dbPath)
        if (!fetchResult.ok) {
          results["opencode-lcm"] = { ok: false, reason: fetchResult.reason, dbPath: fetchResult.dbPath }
        } else {
          const section = renderLcmSection(fetchResult.summaries, fetchResult.artifacts, {
            maxItemLength,
            dbPath: fetchResult.dbPath,
          })
          sections.push(section)
          results["opencode-lcm"] = {
            ok: true,
            dbPath: fetchResult.dbPath,
            summaryCount: fetchResult.summaries.length,
            artifactCount: fetchResult.artifacts.length,
          }
        }
      }

      if (sections.length === 0) {
        return JSON.stringify(
          {
            ok: false,
            message: "No sources returned any data. Check source-specific errors.",
            sources: results,
            hint: "Run opendream_mem_probe to diagnose individual sources.",
          },
          null,
          2,
        )
      }

      // Merge all sections into memory file
      let currentContent = ""
      try {
        currentContent = await readFile(config.memoryFile, "utf8")
      } catch {
        // File doesn't exist yet — start empty
      }

      // Apply each section in order
      let merged = currentContent
      if (mode === "replace") {
        merged = `${sections.join("\n\n")}\n`
      } else {
        for (const section of sections) {
          // Detect which source this section belongs to by its comment tag
          if (section.includes("opencode-mem:sync")) {
            merged = mergeOpencodeMemSection(merged, section, mode)
          } else if (section.includes("true-mem:sync")) {
            merged = mergeTrueMemSection(merged, section, mode)
          } else if (section.includes("simple-memory:sync")) {
            merged = mergeSimpleMemorySection(merged, section, mode)
          } else if (section.includes("opencode-lcm:sync")) {
            merged = mergeLcmSection(merged, section, mode)
          } else {
            merged = `${merged.trimEnd()}\n\n${section}\n`
          }
        }
      }

      if (dryRun) {
        return JSON.stringify(
          {
            ok: true,
            dryRun: true,
            memoryFile: config.memoryFile,
            sourcesProcessed: sections.length,
            sources: results,
            previewContent: merged,
          },
          null,
          2,
        )
      }

      // Write to disk
      await mkdir(dirname(config.memoryFile), { recursive: true })
      await writeFile(config.memoryFile, merged, "utf8")

      return JSON.stringify(
        {
          ok: true,
          dryRun: false,
          memoryFile: config.memoryFile,
          sourcesProcessed: sections.length,
          sources: results,
          totalCharactersWritten: merged.length,
          hint: "Run opendream_reflect_batch → opendream_dream_run → opendream_memory_apply to process these memories through the dream pipeline.",
        },
        null,
        2,
      )
    },
  })
}
