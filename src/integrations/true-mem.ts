/**
 * true-mem integration
 *
 * Reads memories from a true-mem SQLite database.
 * npm package: https://github.com/rizal72/true-mem
 *
 * DB location: ~/.true-mem/memory.db (default, configurable)
 * Table: memory_units
 * Columns used: classification, summary, strength, project_scope, store, status
 *
 * This module is intentionally side-effect free — it only reads and maps data.
 * The caller (tool) is responsible for writing to disk.
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export interface TrueMemItem {
  id: string
  classification: string
  summary: string
  strength: number
  projectScope: string | null
  store: "STM" | "LTM" | string
}

export interface TrueMemFetchResult {
  ok: true
  dbPath: string
  items: TrueMemItem[]
}

export interface TrueMemFetchError {
  ok: false
  dbPath: string
  reason: string
}

export type TrueMemResult = TrueMemFetchResult | TrueMemFetchError

/**
 * Returns the default path to the true-mem SQLite database.
 */
export function defaultTrueMemDbPath(): string {
  return join(homedir(), ".true-mem", "memory.db")
}

/**
 * Reads active memory_units from a true-mem SQLite database.
 *
 * Uses a pure-JS SQLite implementation to avoid native bindings.
 * Never throws — all errors are returned as `{ ok: false, reason }`.
 */
export async function fetchTrueMemItems(dbPath?: string): Promise<TrueMemResult> {
  const resolvedPath = dbPath ?? defaultTrueMemDbPath()

  // Verify file exists by attempting to read a small header
  try {
    const header = await readFile(resolvedPath, { encoding: null })
    // SQLite files start with "SQLite format 3"
    if (!header.slice(0, 16).toString("ascii").startsWith("SQLite format 3")) {
      return {
        ok: false,
        dbPath: resolvedPath,
        reason: `File does not appear to be a SQLite database: ${resolvedPath}`,
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        dbPath: resolvedPath,
        reason: `Database file not found: ${resolvedPath}. Is true-mem installed and have you run any sessions?`,
      }
    }
    return { ok: false, dbPath: resolvedPath, reason: `Cannot read database file: ${msg}` }
  }

  // Dynamic import of better-sqlite3 or sql.js — we try better-sqlite3 first (sync, fast)
  // then fall back to sql.js (pure JS, slower but no native bindings needed)
  let items: TrueMemItem[]
  try {
    items = await readWithBetterSqlite3(resolvedPath)
  } catch (primaryErr) {
    // better-sqlite3 not available — try sql.js
    try {
      items = await readWithSqlJs(resolvedPath)
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      return {
        ok: false,
        dbPath: resolvedPath,
        reason:
          `Could not open SQLite database. ` +
          `Install 'better-sqlite3' or 'sql.js' as a peer dependency to enable true-mem integration. ` +
          `(better-sqlite3 error: ${primaryMsg}; sql.js error: ${msg})`,
      }
    }
  }

  return { ok: true, dbPath: resolvedPath, items }
}

async function readWithBetterSqlite3(dbPath: string): Promise<TrueMemItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Database = (await import("better-sqlite3" as string)).default as any
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = db.prepare(
      `SELECT rowid, classification, summary, strength, project_scope, store
       FROM memory_units
       WHERE status = 'active'
       ORDER BY strength DESC, rowid ASC`,
    ).all() as Array<{
      rowid: number
      classification: string
      summary: string
      strength: number
      project_scope: string | null
      store: string
    }>
    return rows.map((row) => ({
      id: `truemem-${row.rowid}`,
      classification: row.classification ?? "unknown",
      summary: row.summary ?? "",
      strength: typeof row.strength === "number" ? row.strength : 0,
      projectScope: row.project_scope ?? null,
      store: (row.store as "STM" | "LTM") ?? "LTM",
    }))
  } finally {
    db.close()
  }
}

async function readWithSqlJs(dbPath: string): Promise<TrueMemItem[]> {
  const [sqlJsModule, fileContent] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    import("sql.js" as string) as Promise<any>,
    readFile(dbPath),
  ])

  const initSqlJs = sqlJsModule.default ?? sqlJsModule
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SQL = await initSqlJs() as any
  const db = new SQL.Database(fileContent)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = db.exec(
      `SELECT rowid, classification, summary, strength, project_scope, store
       FROM memory_units
       WHERE status = 'active'
       ORDER BY strength DESC, rowid ASC`,
    ) as Array<{ columns: string[]; values: unknown[][] }>

    if (!result || result.length === 0) return []

    const { columns, values } = result[0]
    const colIndex = (name: string) => columns.indexOf(name)

    return values.map((row) => {
      const rowid = row[colIndex("rowid")]
      return {
        id: `truemem-${rowid}`,
        classification: String(row[colIndex("classification")] ?? "unknown"),
        summary: String(row[colIndex("summary")] ?? ""),
        strength: typeof row[colIndex("strength")] === "number" ? (row[colIndex("strength")] as number) : 0,
        projectScope: row[colIndex("project_scope")] != null ? String(row[colIndex("project_scope")]) : null,
        store: String(row[colIndex("store")] ?? "LTM"),
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Renders a markdown section for true-mem items,
 * ready to be injected into memory/current.md.
 */
export function renderTrueMemSection(
  items: TrueMemItem[],
  opts: { maxItemLength?: number; dbPath?: string } = {},
): string {
  const maxLen = opts.maxItemLength ?? 1000
  const timestamp = new Date().toISOString()
  const source = opts.dbPath ?? defaultTrueMemDbPath()

  const lines: string[] = [
    `<!-- true-mem:sync ts="${timestamp}" count="${items.length}" source="${source}" -->`,
    `## External Memories (true-mem)`,
    ``,
    `_Imported ${items.length} item(s) from true-mem at ${timestamp}_`,
    ``,
  ]

  // Group by classification for readability
  const byClass = new Map<string, TrueMemItem[]>()
  for (const item of items) {
    const bucket = byClass.get(item.classification) ?? []
    bucket.push(item)
    byClass.set(item.classification, bucket)
  }

  for (const [cls, group] of byClass) {
    lines.push(`### ${capitalize(cls)}`)
    lines.push(``)
    for (const item of group) {
      const truncated = item.summary.length > maxLen ? item.summary.slice(0, maxLen) + "…" : item.summary
      const meta = [
        `strength: ${item.strength}`,
        item.store !== "LTM" ? `store: ${item.store}` : null,
        item.projectScope ? `scope: ${item.projectScope}` : null,
      ]
        .filter(Boolean)
        .join(", ")
      lines.push(`- ${truncated}${meta ? ` _(${meta})_` : ""}`)
    }
    lines.push(``)
  }

  lines.push(`<!-- /true-mem:sync -->`)

  return lines.join("\n")
}

/**
 * Merges the true-mem section into existing memory file content.
 */
export function mergeTrueMemSection(
  existingContent: string,
  newSection: string,
  mode: "append" | "replace",
): string {
  const BLOCK_PATTERN = /<!-- true-mem:sync[^>]*-->[\s\S]*?<!-- \/true-mem:sync -->\n?/g

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
