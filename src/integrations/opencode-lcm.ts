/**
 * opencode-lcm integration
 *
 * Reads conversation summaries and artifacts from an opencode-lcm SQLite database.
 * npm package: https://github.com/Plutarch01/opencode-lcm
 *
 * DB location: .lcm/lcm.db (relative to project root, default)
 * Tables used:
 *   summaries — session-level summaries (id, session_id, content, created_at)
 *   artifacts — exported artifacts (id, session_id, name, content, type, created_at)
 *   messages  — full message log (id, session_id, role, content, created_at) — optional, large
 *
 * This module is intentionally side-effect free — it only reads and maps data.
 */

import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export interface LcmSummaryItem {
  id: string
  sessionId: string
  content: string
  createdAt: string
}

export interface LcmArtifactItem {
  id: string
  sessionId: string
  name: string
  type: string
  content: string
  createdAt: string
}

export interface LcmFetchResult {
  ok: true
  dbPath: string
  summaries: LcmSummaryItem[]
  artifacts: LcmArtifactItem[]
}

export interface LcmFetchError {
  ok: false
  dbPath: string
  reason: string
}

export type LcmResult = LcmFetchResult | LcmFetchError

function escapeManagedMarkers(value: string): string {
  return value.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;")
}

/**
 * Returns the default path to the opencode-lcm SQLite database.
 */
export function defaultLcmDbPath(projectRoot?: string): string {
  return join(resolve(projectRoot ?? process.cwd()), ".lcm", "lcm.db")
}

/**
 * Reads summaries and artifacts from an opencode-lcm SQLite database.
 * Never throws — all errors are returned as `{ ok: false, reason }`.
 */
export async function fetchLcmItems(dbPath?: string, projectRoot?: string): Promise<LcmResult> {
  const resolvedPath = dbPath ?? defaultLcmDbPath(projectRoot)

  // Verify file exists and is SQLite
  try {
    const header = await readFile(resolvedPath, { encoding: null })
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
        reason: `Database not found: ${resolvedPath}. Is opencode-lcm installed and have you run any sessions?`,
      }
    }
    return { ok: false, dbPath: resolvedPath, reason: `Cannot read database: ${msg}` }
  }

  let summaries: LcmSummaryItem[]
  let artifacts: LcmArtifactItem[]

  try {
    ;[summaries, artifacts] = await readLcmWithBetterSqlite3(resolvedPath)
  } catch (primaryErr) {
    try {
      ;[summaries, artifacts] = await readLcmWithSqlJs(resolvedPath)
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
      const primaryMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      return {
        ok: false,
        dbPath: resolvedPath,
        reason:
          `Could not open SQLite database. ` +
          `Install 'better-sqlite3' or 'sql.js' as a peer dependency. ` +
          `(better-sqlite3: ${primaryMsg}; sql.js: ${msg})`,
      }
    }
  }

  return { ok: true, dbPath: resolvedPath, summaries, artifacts }
}

async function readLcmWithBetterSqlite3(
  dbPath: string,
): Promise<[LcmSummaryItem[], LcmArtifactItem[]]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Database = (await import("better-sqlite3" as string)).default as any
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })

  try {
    // Check which tables exist
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tableNames = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
    ).map((r) => r.name)

    const summaries: LcmSummaryItem[] = []
    const artifacts: LcmArtifactItem[] = []

    if (tableNames.includes("summaries")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = db.prepare(
        `SELECT id, session_id, content, created_at FROM summaries ORDER BY created_at DESC LIMIT 200`,
      ).all() as Array<{ id: string | number; session_id: string; content: string; created_at: string }>

      for (const r of rows) {
        summaries.push({
          id: `lcm-summary-${r.id}`,
          sessionId: r.session_id ?? "",
          content: r.content ?? "",
          createdAt: r.created_at ?? "",
        })
      }
    }

    if (tableNames.includes("artifacts")) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = db.prepare(
        `SELECT id, session_id, name, type, content, created_at FROM artifacts ORDER BY created_at DESC LIMIT 100`,
      ).all() as Array<{
        id: string | number
        session_id: string
        name: string
        type: string
        content: string
        created_at: string
      }>

      for (const r of rows) {
        artifacts.push({
          id: `lcm-artifact-${r.id}`,
          sessionId: r.session_id ?? "",
          name: r.name ?? "",
          type: r.type ?? "unknown",
          content: r.content ?? "",
          createdAt: r.created_at ?? "",
        })
      }
    }

    return [summaries, artifacts]
  } finally {
    db.close()
  }
}

async function readLcmWithSqlJs(dbPath: string): Promise<[LcmSummaryItem[], LcmArtifactItem[]]> {
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
    const tableResult = db.exec(
      `SELECT name FROM sqlite_master WHERE type='table'`,
    ) as Array<{ columns: string[]; values: unknown[][] }>

    const tableNames = tableResult.length > 0 ? tableResult[0].values.map((r) => String(r[0])) : []

    const summaries: LcmSummaryItem[] = []
    const artifacts: LcmArtifactItem[] = []

    if (tableNames.includes("summaries")) {
      const result = db.exec(
        `SELECT id, session_id, content, created_at FROM summaries ORDER BY created_at DESC LIMIT 200`,
      ) as Array<{ columns: string[]; values: unknown[][] }>

      if (result.length > 0) {
        const { columns, values } = result[0]
        const col = (n: string) => columns.indexOf(n)
        for (const row of values) {
          summaries.push({
            id: `lcm-summary-${row[col("id")]}`,
            sessionId: String(row[col("session_id")] ?? ""),
            content: String(row[col("content")] ?? ""),
            createdAt: String(row[col("created_at")] ?? ""),
          })
        }
      }
    }

    if (tableNames.includes("artifacts")) {
      const result = db.exec(
        `SELECT id, session_id, name, type, content, created_at FROM artifacts ORDER BY created_at DESC LIMIT 100`,
      ) as Array<{ columns: string[]; values: unknown[][] }>

      if (result.length > 0) {
        const { columns, values } = result[0]
        const col = (n: string) => columns.indexOf(n)
        for (const row of values) {
          artifacts.push({
            id: `lcm-artifact-${row[col("id")]}`,
            sessionId: String(row[col("session_id")] ?? ""),
            name: String(row[col("name")] ?? ""),
            type: String(row[col("type")] ?? "unknown"),
            content: String(row[col("content")] ?? ""),
            createdAt: String(row[col("created_at")] ?? ""),
          })
        }
      }
    }

    return [summaries, artifacts]
  } finally {
    db.close()
  }
}

/**
 * Renders a markdown section for LCM items,
 * ready to be injected into memory/current.md.
 */
export function renderLcmSection(
  summaries: LcmSummaryItem[],
  artifacts: LcmArtifactItem[],
  opts: { maxItemLength?: number; dbPath?: string } = {},
): string {
  const maxLen = opts.maxItemLength ?? 1000
  const timestamp = new Date().toISOString()
  const source = opts.dbPath ?? ".lcm/lcm.db"
  const total = summaries.length + artifacts.length

  const lines: string[] = [
    `<!-- opencode-lcm:sync ts="${timestamp}" count="${total}" source="${source}" -->`,
    `## External Memories (opencode-lcm)`,
    ``,
    `_Imported ${total} item(s) from opencode-lcm at ${timestamp}_`,
    ``,
  ]

  if (summaries.length > 0) {
    lines.push(`### Session Summaries`)
    lines.push(``)
    for (const s of summaries) {
      const truncated = s.content.length > maxLen ? s.content.slice(0, maxLen) + "…" : s.content
      lines.push(`#### Session ${s.sessionId} (${s.createdAt})`)
      lines.push(escapeManagedMarkers(truncated))
      lines.push(``)
    }
  }

  if (artifacts.length > 0) {
    lines.push(`### Artifacts`)
    lines.push(``)
    for (const a of artifacts) {
      const truncated = a.content.length > maxLen ? a.content.slice(0, maxLen) + "…" : a.content
      lines.push(`#### ${a.name} _(${a.type})_`)
      lines.push(escapeManagedMarkers(truncated))
      lines.push(``)
    }
  }

  lines.push(`<!-- /opencode-lcm:sync -->`)

  return lines.join("\n")
}

/**
 * Merges the opencode-lcm section into existing memory file content.
 */
export function mergeLcmSection(
  existingContent: string,
  newSection: string,
  mode: "append" | "replace",
): string {
  const BLOCK_PATTERN = /<!-- opencode-lcm:sync[^>]*-->[\s\S]*?<!-- \/opencode-lcm:sync -->\n?/g

  if (mode === "replace") {
    return newSection + "\n"
  }

  if (BLOCK_PATTERN.test(existingContent)) {
    return existingContent.replace(BLOCK_PATTERN, newSection + "\n")
  }

  return `${existingContent.trimEnd()}\n\n${newSection}\n`
}
