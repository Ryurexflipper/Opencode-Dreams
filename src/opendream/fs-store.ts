import { access, copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { basename, dirname, join, parse } from "node:path"

import type { DreamReflection } from "./reflection.js"

import { DREAM_DIRECTORIES } from "./constants.js"

export interface DreamLayoutSummary {
  root: string
  createdDirectories: string[]
  createdFiles: string[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function ensureFile(path: string, content: string, createdFiles: string[]): Promise<void> {
  if (await exists(path)) {
    return
  }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
  createdFiles.push(path)
}

export async function ensureDreamLayout(root: string): Promise<DreamLayoutSummary> {
  const createdDirectories: string[] = []
  const createdFiles: string[] = []

  await mkdir(root, { recursive: true })
  for (const relativeDir of DREAM_DIRECTORIES) {
    const fullPath = join(root, relativeDir)
    if (!(await exists(fullPath))) {
      createdDirectories.push(fullPath)
    }
    await mkdir(fullPath, { recursive: true })
  }

  await ensureFile(
    join(root, "memory", "current.md"),
    [
      "## Opencode-Dream consolidated memory",
      "",
      "_(empty placeholder; replace with reviewed memory content before export)_",
      "",
    ].join("\n"),
    createdFiles,
  )

  await ensureFile(
    join(root, "docs", "README.md"),
    [
      "# .opencode-dream state",
      "",
      "This directory is managed by the Opencode-Dream plugin scaffold.",
      "",
      "- `sessions/` stores imported or captured traces",
      "- `reflections/` is reserved for Stage 1 output",
      "- `dreams/` is reserved for Stage 2 output",
      "- `memory/current.md` is the current export source",
      "",
    ].join("\n"),
    createdFiles,
  )

  return { root, createdDirectories, createdFiles }
}

export async function readCurrentMemory(root: string): Promise<string> {
  return readFile(join(root, "memory", "current.md"), "utf8")
}

export async function summarizeDreamState(root: string): Promise<Record<string, unknown>> {
  const memoryPath = join(root, "memory", "current.md")
  const sessionImportsPath = join(root, "sessions", "imports")
  const sessionLivePath = join(root, "sessions", "live")
  const sessionRuntimePath = join(root, "sessions", "runtime")
  const reflectionPath = join(root, "reflections")
  const sessionImportEntries = (await exists(sessionImportsPath)) ? await readdir(sessionImportsPath) : []
  const sessionLiveEntries = (await exists(sessionLivePath)) ? await readdir(sessionLivePath) : []
  const sessionRuntimeEntries = (await exists(sessionRuntimePath)) ? await readdir(sessionRuntimePath) : []
  const reflectionEntries = (await exists(reflectionPath)) ? await readdir(reflectionPath) : []
  const memoryContent = (await exists(memoryPath)) ? await readFile(memoryPath, "utf8") : ""

  return {
    root,
    memoryPath,
    memoryExists: await exists(memoryPath),
    memoryPreview: memoryContent.trim().slice(0, 200),
    importedSessionFiles: sessionImportEntries.length,
    importedSessionNames: sessionImportEntries.slice(0, 20),
    liveSessionFiles: sessionLiveEntries.length,
    liveSessionNames: sessionLiveEntries.slice(0, 20),
    runtimeSessionFiles: sessionRuntimeEntries.length,
    runtimeSessionNames: sessionRuntimeEntries.slice(0, 20),
    reflectionFiles: reflectionEntries.length,
    reflectionNames: reflectionEntries.slice(0, 20),
  }
}

export async function importFileIntoDreamSessions(root: string, sourcePath: string): Promise<string> {
  const targetDir = join(root, "sessions", "imports")
  await mkdir(targetDir, { recursive: true })
  const parsed = parse(sourcePath)
  const extension = parsed.ext || ".jsonl"
  let destination = join(targetDir, `${parsed.name}${extension}`)
  let suffix = 1

  while (await exists(destination)) {
    destination = join(targetDir, `${parsed.name}-${suffix}${extension}`)
    suffix += 1
  }

  await copyFile(sourcePath, destination)
  return destination
}

export async function writeDreamReflection(root: string, sessionID: string, reflection: DreamReflection): Promise<string> {
  const target = join(root, "reflections", `${sessionID}.json`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(reflection, null, 2)}\n`, "utf8")
  return target
}

export async function readFirstGenericJsonlSession(rootPath: string): Promise<string> {
  const text = await readFile(rootPath, "utf8")
  const line = text.split(/\r?\n/).find((value) => value.trim().length > 0)
  if (!line) {
    throw new Error(`No session rows found in ${basename(rootPath)}`)
  }
  return line
}
