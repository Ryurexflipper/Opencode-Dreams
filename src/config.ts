import { isAbsolute, join, relative, resolve } from "node:path"

export interface DreamPluginOptions {
  projectRelativeStateDir?: string
  memoryFile?: string
  agentsFile?: string
  captureLiveSessions?: boolean
  preferredReflectModel?: string
  preferredDreamModel?: string
  logLevel?: "debug" | "info" | "warn" | "error"
  /** opencode-mem integration: base URL of the opencode-mem server (e.g. "http://127.0.0.1:4747") */
  opencodeMem?: {
    enabled: boolean
    url?: string
    /** How to incorporate imported memories into memory/current.md: "append" (default) | "replace" */
    importMode?: "append" | "replace"
    /** Max characters per memory item to include in the memory file (default: 1000) */
    maxItemLength?: number
  }
}

export interface DreamResolvedConfig {
  pluginId: string
  pluginName: string
  stateDir: string
  memoryFile: string
  agentsFile: string
  captureLiveSessions: boolean
  sessionLiveDir: string
  sessionRuntimeDir: string
  reflectionDir: string
  preferredReflectModel?: string
  preferredDreamModel?: string
  logLevel: "debug" | "info" | "warn" | "error"
  opencodeMem: {
    enabled: boolean
    url: string
    importMode: "append" | "replace"
    maxItemLength: number
  }
}

export function resolveDreamConfig(
  directory: string,
  options: Record<string, unknown> | undefined,
): DreamResolvedConfig {
  const typed = (options ?? {}) as DreamPluginOptions
  const projectRoot = resolve(directory)
  const stateDir = assertWithinProjectRoot(projectRoot, resolve(directory, typed.projectRelativeStateDir ?? ".opencode-dream"), "projectRelativeStateDir")
  const memoryFile = typed.memoryFile
    ? assertWithinProjectRoot(projectRoot, resolve(directory, typed.memoryFile), "memoryFile")
    : join(stateDir, "memory", "current.md")
  const agentsFile = typed.agentsFile
    ? assertWithinProjectRoot(projectRoot, resolve(directory, typed.agentsFile), "agentsFile")
    : resolve(directory, "AGENTS.md")

  return {
    pluginId: "opencode-dream",
    pluginName: "Opencode-Dream",
    stateDir,
    memoryFile,
    agentsFile,
    captureLiveSessions: typed.captureLiveSessions ?? true,
    sessionLiveDir: join(stateDir, "sessions", "live"),
    sessionRuntimeDir: join(stateDir, "sessions", "runtime"),
    reflectionDir: join(stateDir, "reflections"),
    preferredReflectModel: typed.preferredReflectModel,
    preferredDreamModel: typed.preferredDreamModel,
    logLevel: typed.logLevel ?? "info",
    opencodeMem: {
      enabled: typed.opencodeMem?.enabled ?? false,
      url: typed.opencodeMem?.url ?? "http://127.0.0.1:4747",
      importMode: typed.opencodeMem?.importMode ?? "append",
      maxItemLength: typed.opencodeMem?.maxItemLength ?? 1000,
    },
  }
}

function assertWithinProjectRoot(projectRoot: string, targetPath: string, label: string): string {
  const rel = relative(projectRoot, targetPath)
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return targetPath
  }
  throw new Error(`${label} must stay within the project root: ${projectRoot}`)
}
