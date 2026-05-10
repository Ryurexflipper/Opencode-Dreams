/**
 * opencode-mem integration
 *
 * Reads memories from an opencode-mem server (https://github.com/joshwcomeau/opencode-mem or similar)
 * running at a configurable HTTP endpoint.
 *
 * API contract assumed:
 *   GET /api/memories  →  { success: boolean, data: { items: MemItem[] } }
 *   MemItem: { type: string, id: string, content: string, [meta]?: unknown }
 *
 * This module is intentionally side-effect free — it only fetches and maps data.
 * The caller (tool) is responsible for writing to disk.
 */

export interface OpencodeMemItem {
  id: string
  type: string
  content: string
  /** Any extra fields the server returns — stored as-is for transparency */
  meta?: Record<string, unknown>
}

export interface OpencodeMemFetchResult {
  ok: true
  url: string
  items: OpencodeMemItem[]
}

export interface OpencodeMemFetchError {
  ok: false
  url: string
  reason: string
}

export type OpencodeMemResult = OpencodeMemFetchResult | OpencodeMemFetchError

function escapeManagedMarkers(value: string): string {
  return value.replaceAll("<!--", "&lt;!--").replaceAll("-->", "--&gt;")
}

/**
 * Fetches all memory items from an opencode-mem HTTP server.
 * Never throws — all errors are returned as `{ ok: false, reason }`.
 */
export async function fetchOpencodeMemItems(baseUrl: string): Promise<OpencodeMemResult> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/memories`

  let resp: Response
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, url, reason: `Network error: ${msg}` }
  }

  if (!resp.ok) {
    return { ok: false, url, reason: `HTTP ${resp.status} ${resp.statusText}` }
  }

  let json: unknown
  try {
    json = await resp.json()
  } catch {
    return { ok: false, url, reason: "Response body is not valid JSON" }
  }

  // Validate shape
  if (
    !json ||
    typeof json !== "object" ||
    !("data" in json) ||
    !json.data ||
    typeof json.data !== "object" ||
    !("items" in (json.data as object)) ||
    !Array.isArray((json.data as Record<string, unknown>).items)
  ) {
    return { ok: false, url, reason: "Unexpected response shape — expected { data: { items: [] } }" }
  }

  const rawItems = ((json.data as Record<string, unknown>).items as unknown[])

  const items: OpencodeMemItem[] = rawItems.map((raw) => {
    if (!raw || typeof raw !== "object") {
      return { id: "unknown", type: "unknown", content: String(raw) }
    }
    const r = raw as Record<string, unknown>
    const { id, type, content, ...rest } = r
    return {
      id: typeof id === "string" ? id : "unknown",
      type: typeof type === "string" ? type : "memory",
      content: typeof content === "string" ? content : JSON.stringify(content),
      meta: Object.keys(rest).length > 0 ? (rest as Record<string, unknown>) : undefined,
    }
  })

  return { ok: true, url, items }
}

/**
 * Renders a markdown section for a list of opencode-mem items,
 * ready to be injected into memory/current.md.
 */
export function renderOpencodeMemSection(
  items: OpencodeMemItem[],
  opts: { maxItemLength?: number; sourceUrl?: string } = {},
): string {
  const maxLen = opts.maxItemLength ?? 1000
  const timestamp = new Date().toISOString()
  const source = opts.sourceUrl ?? "opencode-mem"

  const lines: string[] = [
    `<!-- opencode-mem:sync ts="${timestamp}" count="${items.length}" source="${source}" -->`,
    `## External Memories (opencode-mem)`,
    ``,
    `_Imported ${items.length} item(s) from \`${source}\` at ${timestamp}_`,
    ``,
  ]

  for (const item of items) {
    const truncated = item.content.length > maxLen ? item.content.slice(0, maxLen) + "…" : item.content
    lines.push(`### [${item.id}]`)
    lines.push(escapeManagedMarkers(truncated))
    lines.push(``)
  }

  lines.push(`<!-- /opencode-mem:sync -->`)

  return lines.join("\n")
}

/**
 * Merges the opencode-mem section into existing memory file content.
 * In "replace" mode: replaces the entire opencode-mem:sync block.
 * In "append" mode: replaces existing sync block if present, appends if not.
 */
export function mergeOpencodeMemSection(
  existingContent: string,
  newSection: string,
  mode: "append" | "replace",
): string {
  const BLOCK_PATTERN = /<!-- opencode-mem:sync[^>]*-->[\s\S]*?<!-- \/opencode-mem:sync -->\n?/g

  if (mode === "replace") {
    return newSection + "\n"
  }

  // Append mode: replace existing block if present, else append
  if (BLOCK_PATTERN.test(existingContent)) {
    return existingContent.replace(BLOCK_PATTERN, newSection + "\n")
  }

  return `${existingContent.trimEnd()}\n\n${newSection}\n`
}
