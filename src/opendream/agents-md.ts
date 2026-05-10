import { readFile, writeFile } from "node:fs/promises"

import { DREAM_BEGIN_MARKER, DREAM_END_MARKER } from "./constants.js"

function escapeManagedMarkers(value: string): string {
  return value
    .replaceAll(DREAM_BEGIN_MARKER, "&lt;!-- OPENCODE-DREAM:BEGIN --&gt;")
    .replaceAll(DREAM_END_MARKER, "&lt;!-- OPENCODE-DREAM:END --&gt;")
}

export function buildDreamManagedBlock(memoryMarkdown: string): string {
  const body = escapeManagedMarkers(memoryMarkdown.trim())
  return [
    DREAM_BEGIN_MARKER,
    "## Opencode-Dream consolidated memory",
    "",
    "_Managed by the Opencode-Dream plugin scaffold. Content between these markers is replaceable._",
    "",
    body || "_(no memory content yet)_",
    DREAM_END_MARKER,
    "",
  ].join("\n")
}

export function findDreamManagedBlockBounds(existing: string): { begin: number; end: number } | null {
  let begin = existing.indexOf(DREAM_BEGIN_MARKER)
  while (begin >= 0) {
    const end = existing.indexOf(DREAM_END_MARKER, begin + DREAM_BEGIN_MARKER.length)
    if (end > begin) {
      return { begin, end }
    }
    begin = existing.indexOf(DREAM_BEGIN_MARKER, begin + DREAM_BEGIN_MARKER.length)
  }

  return null
}

export async function exportDreamManagedSection(
  agentsFile: string,
  memoryMarkdown: string,
): Promise<{ agentsFile: string; action: "created" | "replaced" | "appended" }> {
  const block = buildDreamManagedBlock(memoryMarkdown)

  let existing = ""
  try {
    existing = await readFile(agentsFile, "utf8")
  } catch {
    await writeFile(
      agentsFile,
      [
        "# AGENTS.md",
        "",
        "Project guidance for AI agents.",
        "",
        block,
      ].join("\n"),
      "utf8",
    )
    return { agentsFile, action: "created" }
  }

  const bounds = findDreamManagedBlockBounds(existing)
  if (bounds) {
    const before = existing.slice(0, bounds.begin)
    const after = existing.slice(bounds.end + DREAM_END_MARKER.length)
    const next = `${before}${block}${after.startsWith("\n") ? after.slice(1) : after}`
    await writeFile(agentsFile, next, "utf8")
    return { agentsFile, action: "replaced" }
  }

  const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n"
  await writeFile(agentsFile, `${existing}${separator}${block}`, "utf8")
  return { agentsFile, action: "appended" }
}
