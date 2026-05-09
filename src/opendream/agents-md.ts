import { readFile, writeFile } from "node:fs/promises"

import { DREAM_BEGIN_MARKER, DREAM_END_MARKER } from "./constants.js"

function buildManagedBlock(memoryMarkdown: string): string {
  const body = memoryMarkdown.trim()
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

export async function exportDreamManagedSection(
  agentsFile: string,
  memoryMarkdown: string,
): Promise<{ agentsFile: string; action: "created" | "replaced" | "appended" }> {
  const block = buildManagedBlock(memoryMarkdown)

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

  const begin = existing.indexOf(DREAM_BEGIN_MARKER)
  const end = existing.indexOf(DREAM_END_MARKER)
  if (begin >= 0 && end > begin) {
    const before = existing.slice(0, begin)
    const after = existing.slice(end + DREAM_END_MARKER.length)
    const next = `${before}${block}${after.startsWith("\n") ? after.slice(1) : after}`
    await writeFile(agentsFile, next, "utf8")
    return { agentsFile, action: "replaced" }
  }

  const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n"
  await writeFile(agentsFile, `${existing}${separator}${block}`, "utf8")
  return { agentsFile, action: "appended" }
}
