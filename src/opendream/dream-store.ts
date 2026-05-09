import { mkdir, readdir, writeFile } from "node:fs/promises"
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
    return entries.filter((e) => e.endsWith(".json")).map((e) => join(dir, e))
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
