/**
 * simple-memory integration
 *
 * Reads memories from the opencode-plugin-simple-memory logfmt file store.
 * npm package: @knikolov/opencode-plugin-simple-memory
 *
 * Storage: `.opencode/memory/*.logfmt` (daily files, e.g. 2026-05-09.logfmt)
 * Format: key=value pairs per line, e.g.:
 *   ts=2026-05-09T12:00:00.000Z type=decision scope=user content="run typecheck first"
 *
 * Types: decision, learning, preference, blocker, context, pattern
 *
 * This module is intentionally side-effect free — it only reads and maps data.
 */

import { readdir, readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export type SimpleMemoryType = "decision" | "learning" | "preference" | "blocker" | "context" | "pattern" | string

export interface SimpleMemoryItem {
  id: string
  ts: string
  type: SimpleMemoryType
  scope: string
  content: string
  /** Raw filename where this was found */
  sourceFile: string
}

export interface SimpleMemoryFetchResult {
  ok: true
  directory: string
  files: string[]
  items: SimpleMemoryItem[]
}

export interface SimpleMemoryFetchError {
  ok: false
  directory: string
  reason: string
}

export type SimpleMemoryResult = SimpleMemoryFetchResult | SimpleMemoryFetchError

function escapeManagedMarkers(value: string): string {
  return value.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;")
}

/**
 * Returns the default simple-memory directory for a project.
 */
export function defaultSimpleMemoryDir(projectRoot: string): string {
  return join(resolve(projectRoot), ".opencode", "memory")
}

/**
 * Reads all logfmt memory files from the simple-memory directory.
 * Never throws — all errors are returned as `{ ok: false, reason }`.
 */
export async function fetchSimpleMemoryItems(
  memoryDir?: string,
  projectRoot?: string,
): Promise<SimpleMemoryResult> {
  const resolvedDir = memoryDir ?? defaultSimpleMemoryDir(projectRoot ?? process.cwd())

  let allFiles: string[]
  try {
    const entries = await readdir(resolvedDir)
    allFiles = entries.filter((f) => f.endsWith(".logfmt")).sort()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        directory: resolvedDir,
        reason: `Memory directory not found: ${resolvedDir}. Is @knikolov/opencode-plugin-simple-memory installed?`,
      }
    }
    return { ok: false, directory: resolvedDir, reason: `Cannot list memory directory: ${msg}` }
  }

  if (allFiles.length === 0) {
    return { ok: true, directory: resolvedDir, files: [], items: [] }
  }

  const items: SimpleMemoryItem[] = []
  const usedFiles: string[] = []

  for (const filename of allFiles) {
    const filePath = join(resolvedDir, filename)
    let content: string
    try {
      content = await readFile(filePath, "utf8")
    } catch {
      // Skip unreadable files
      continue
    }

    usedFiles.push(filePath)
    const parsed = parseLogfmt(content, filename)
    items.push(...parsed)
  }

  return { ok: true, directory: resolvedDir, files: usedFiles, items }
}

/**
 * Parses a logfmt file into SimpleMemoryItem[].
 * Format: key=value or key="quoted value" per line.
 */
export function parseLogfmt(content: string, sourceFile = "unknown"): SimpleMemoryItem[] {
  const items: SimpleMemoryItem[] = []
  const lines = content.split("\n").filter((l) => l.trim().length > 0)

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim()
    if (!line || line.startsWith("#")) continue

    const parsed: Record<string, string> = {}
    parseLogfmtLine(line, parsed)

    if (!parsed.content) continue // Skip lines with no content field

    items.push({
      id: `simplemem-${sourceFile}-${lineIdx}`,
      ts: parsed.ts ?? new Date().toISOString(),
      type: parsed.type ?? "context",
      scope: parsed.scope ?? "user",
      content: parsed.content,
      sourceFile,
    })
  }

  return items
}

/**
 * Parses a single logfmt line into key=value pairs.
 * Handles quoted values with escaped quotes inside.
 */
function parseLogfmtLine(line: string, out: Record<string, string>): void {
  let i = 0
  while (i < line.length) {
    // Skip whitespace
    while (i < line.length && line[i] === " ") i++
    if (i >= line.length) break

    // Read key
    const keyStart = i
    while (i < line.length && line[i] !== "=" && line[i] !== " ") i++
    const key = line.slice(keyStart, i)
    if (!key) { i++; continue }

    if (line[i] !== "=") {
      // Bare key with no value — treat as boolean true
      out[key] = "true"
      continue
    }
    i++ // consume '='

    // Read value
    if (i >= line.length) {
      out[key] = ""
      break
    }

    if (line[i] === '"') {
      // Quoted value
      i++ // consume opening quote
      const valueStart = i
      let value = ""
      while (i < line.length) {
        if (line[i] === "\\" && i + 1 < line.length && line[i + 1] === '"') {
          value += '"'
          i += 2
        } else if (line[i] === '"') {
          i++ // consume closing quote
          break
        } else {
          value += line[i]
          i++
        }
      }
      out[key] = value
      void valueStart
    } else {
      // Unquoted value — read until whitespace
      const valueStart = i
      while (i < line.length && line[i] !== " ") i++
      out[key] = line.slice(valueStart, i)
    }
  }
}

/**
 * Renders a markdown section for simple-memory items,
 * ready to be injected into memory/current.md.
 */
export function renderSimpleMemorySection(
  items: SimpleMemoryItem[],
  opts: { maxItemLength?: number; directory?: string } = {},
): string {
  const maxLen = opts.maxItemLength ?? 1000
  const timestamp = new Date().toISOString()
  const source = opts.directory ?? ".opencode/memory"

  const lines: string[] = [
    `<!-- simple-memory:sync ts="${timestamp}" count="${items.length}" source="${source}" -->`,
    `## External Memories (simple-memory)`,
    ``,
    `_Imported ${items.length} item(s) from simple-memory at ${timestamp}_`,
    ``,
  ]

  // Group by type
  const byType = new Map<string, SimpleMemoryItem[]>()
  for (const item of items) {
    const bucket = byType.get(item.type) ?? []
    bucket.push(item)
    byType.set(item.type, bucket)
  }

  // Type display order
  const typeOrder = ["decision", "learning", "preference", "pattern", "context", "blocker"]
  const sorted = [
    ...typeOrder.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((k) => !typeOrder.includes(k)),
  ]

  for (const type of sorted) {
    const group = byType.get(type)!
    lines.push(`### ${capitalize(type)}`)
    lines.push(``)
    for (const item of group) {
      const truncated = item.content.length > maxLen ? item.content.slice(0, maxLen) + "…" : item.content
      lines.push(`- ${escapeManagedMarkers(truncated)}${item.scope !== "user" ? ` _(scope: ${item.scope})_` : ""}`)
    }
    lines.push(``)
  }

  lines.push(`<!-- /simple-memory:sync -->`)

  return lines.join("\n")
}

/**
 * Merges the simple-memory section into existing memory file content.
 */
export function mergeSimpleMemorySection(
  existingContent: string,
  newSection: string,
  mode: "append" | "replace",
): string {
  const BLOCK_PATTERN = /<!-- simple-memory:sync[^>]*-->[\s\S]*?<!-- \/simple-memory:sync -->\n?/g

  if (mode === "replace") {
    return newSection + "\n"
  }

  if (BLOCK_PATTERN.test(existingContent)) {
    return existingContent.replace(BLOCK_PATTERN, newSection + "\n")
  }

  return `${existingContent.trimEnd()}\n\n${newSection}\n`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
