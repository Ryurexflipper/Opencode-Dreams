import { readdir } from "node:fs/promises"
import { join, basename } from "node:path"

import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { readDreamEnvironment } from "../env.js"
import { writeDreamReflection } from "../opendream/fs-store.js"
import { listReflectionFiles } from "../opendream/dream-store.js"
import { readGenericJsonlSessionFile } from "../opendream/generic-jsonl.js"
import { reflectionFromJson, renderDreamReflectionPrompt, resolveDreamSessionID } from "../opendream/reflection.js"

function resolveModel(
  override: string | undefined,
  config: DreamResolvedConfig,
): { providerID: string; modelID: string } {
  const raw = override ?? config.preferredReflectModel ?? readDreamEnvironment().reflectModel
  if (!raw) {
    throw new Error(
      "No reflect model configured. Provide modelOverride, set preferredReflectModel in plugin options, or set OPENCODE_DREAM_REFLECT_MODEL.",
    )
  }
  const slash = raw.indexOf("/")
  if (slash < 1) {
    throw new Error(`Invalid model string "${raw}". Expected "providerID/modelID" format.`)
  }
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

function extractTextFromParts(parts: unknown[]): string {
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" && part !== null && (part as Record<string, unknown>).type === "text",
    )
    .map((part) => part.text)
    .join("\n")
}

async function listUnprocessedSessionFiles(root: string): Promise<string[]> {
  const dirs = [join(root, "sessions", "imports"), join(root, "sessions", "live")]
  const existingReflections = new Set(
    (await listReflectionFiles(root)).map((fp) => basename(fp).replace(/\.json$/, "")),
  )

  const result: string[] = []
  for (const dir of dirs) {
    let entries: string[] = []
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue
      const sessionID = entry.replace(/\.jsonl$/, "")
      if (!existingReflections.has(sessionID)) {
        result.push(join(dir, entry))
      }
    }
  }
  return result
}

export function createOpencodeDreamReflectBatchTool(
  config: DreamResolvedConfig,
  client: PluginInput["client"],
) {
  return tool({
    description:
      "Batch mode: finds all session files in sessions/imports/ and sessions/live/ that have no corresponding reflection yet, and runs Stage 1 reflection on each. Reports per-session success/failure.",
    args: {
      modelOverride: tool.schema
        .string()
        .optional()
        .describe("Model to use in providerID/modelID format. Defaults to plugin config or OPENCODE_DREAM_REFLECT_MODEL."),
      maxMessageChars: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional per-message truncation limit for each reflection prompt"),
      limit: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of sessions to process in this run. Useful for large backlogs."),
      dryRun: tool.schema
        .boolean()
        .optional()
        .describe("If true, only lists what would be processed without actually running reflections."),
    },
    async execute(args) {
      const model = resolveModel(args.modelOverride, config)
      let pending = await listUnprocessedSessionFiles(config.stateDir)

      if (args.limit && args.limit > 0) {
        pending = pending.slice(0, args.limit)
      }

      if (pending.length === 0) {
        return JSON.stringify(
          {
            message: "All sessions already have reflections. Nothing to process.",
            stateDir: config.stateDir,
          },
          null,
          2,
        )
      }

      if (args.dryRun) {
        return JSON.stringify(
          {
            dryRun: true,
            pendingCount: pending.length,
            pendingFiles: pending,
          },
          null,
          2,
        )
      }

      const results: Array<{ sessionFile: string; status: "success" | "error"; reflectionFilePath?: string; error?: string }> = []

      for (const sessionFilePath of pending) {
        try {
          const session = await readGenericJsonlSessionFile(sessionFilePath)
          const sessionID = resolveDreamSessionID(session, sessionFilePath)
          const prompt = renderDreamReflectionPrompt(session, { maxMessageChars: args.maxMessageChars })

          const created = await client.session.create({
            body: { title: `opendream-reflect-batch:${sessionID}` },
          })
          const ephemeralID = created.data?.id
          if (!ephemeralID) {
            throw new Error("Failed to create ephemeral session")
          }

          let rawText: string
          try {
            const response = await client.session.prompt({
              path: { id: ephemeralID },
              body: {
                system: prompt.system,
                model,
                tools: {},
                parts: [{ type: "text", text: prompt.user }],
              },
            })
            rawText = extractTextFromParts((response.data?.parts as unknown[]) ?? [])
          } finally {
            await client.session.delete({ path: { id: ephemeralID } }).catch(() => undefined)
          }

          if (!rawText.trim()) throw new Error("Model returned no text")

          const jsonText = rawText
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim()

          const parsed = JSON.parse(jsonText) as unknown
          const reflection = reflectionFromJson(parsed, sessionID)
          const filePath = await writeDreamReflection(config.stateDir, sessionID, reflection)

          results.push({ sessionFile: sessionFilePath, status: "success", reflectionFilePath: filePath })
        } catch (err) {
          results.push({ sessionFile: sessionFilePath, status: "error", error: String(err) })
        }
      }

      const succeeded = results.filter((r) => r.status === "success").length
      const failed = results.filter((r) => r.status === "error").length

      return JSON.stringify(
        {
          processed: results.length,
          succeeded,
          failed,
          model,
          results,
        },
        null,
        2,
      )
    },
  })
}
