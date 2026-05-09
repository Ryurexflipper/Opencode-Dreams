import { join, resolve } from "node:path"

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
  const stateDir = resolve(directory, typed.projectRelativeStateDir ?? ".opencode-dream")

  return {
    pluginId: "opencode-dream",
    pluginName: "Opencode-Dream",
    stateDir,
    memoryFile: typed.memoryFile ? resolve(directory, typed.memoryFile) : join(stateDir, "memory", "current.md"),
    agentsFile: typed.agentsFile ? resolve(directory, typed.agentsFile) : resolve(directory, "AGENTS.md"),
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
