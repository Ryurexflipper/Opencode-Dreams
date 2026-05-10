import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { DreamConsolidation } from "./dream.js"

export async function writeDreamConsolidation(root: string, consolidation: DreamConsolidation): Promise<string> {
  const dir = join(root, "dreams")
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${consolidation.id}.json`)
  await writeFile(target, `${JSON.stringify(consolidation, null, 2)}\n`, "utf8")
  return target
}

export async function listDreamConsolidations(root: string): Promise<string[]> {
  const dir = join(root, "dreams")
  try {
    const entries = await readdir(dir)
    const files = entries.filter((e) => e.endsWith(".json")).map((e) => join(dir, e))
    const withStats = await Promise.all(
      files.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs })),
    )
    return withStats.sort((a, b) => a.mtimeMs - b.mtimeMs || a.filePath.localeCompare(b.filePath)).map((f) => f.filePath)
  } catch {
    return []
  }
}

export async function listReflectionFiles(root: string): Promise<string[]> {
  const dir = join(root, "reflections")
  try {
    const entries = await readdir(dir)
    return entries.filter((e) => e.endsWith(".json")).map((e) => join(dir, e))
  } catch {
    return []
  }
}
