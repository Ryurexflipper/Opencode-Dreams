import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { readDreamEnvironment } from "../env.js"
import { writeDreamReflection } from "../opendream/fs-store.js"
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
    throw new Error(
      `Invalid model string "${raw}". Expected "providerID/modelID" format (e.g. "github-copilot/gpt-5.4").`,
    )
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

export function createOpencodeDreamReflectRunTool(
  config: DreamResolvedConfig,
  client: PluginInput["client"],
) {
  return tool({
    description:
      "Runs the Stage 1 reflection pipeline automatically: reads a session snapshot, sends the reflection prompt to a model, validates and stores the resulting reflection JSON.",
    args: {
      sessionFilePath: tool.schema.string().describe("Path to a saved session .jsonl file to reflect on"),
      modelOverride: tool.schema
        .string()
        .optional()
        .describe(
          "Model to use in providerID/modelID format (e.g. 'github-copilot/gpt-5.4'). Defaults to plugin config or OPENCODE_DREAM_REFLECT_MODEL.",
        ),
      maxMessageChars: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional per-message truncation limit for the reflection prompt"),
    },
    async execute(args) {
      const model = resolveModel(args.modelOverride, config)
      const session = await readGenericJsonlSessionFile(args.sessionFilePath)
      const sessionID = resolveDreamSessionID(session, args.sessionFilePath)
      const prompt = renderDreamReflectionPrompt(session, { maxMessageChars: args.maxMessageChars })

      // Create an ephemeral session for the model call
      const created = await client.session.create({
        body: { title: `opendream-reflect:${sessionID}` },
      })
      const ephemeralID = created.data?.id
      if (!ephemeralID) {
        throw new Error("Failed to create ephemeral session for reflection execution")
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
        // Best-effort cleanup — do not throw if delete fails
        await client.session.delete({ path: { id: ephemeralID } }).catch(() => undefined)
      }

      if (!rawText.trim()) {
        return JSON.stringify(
          {
            error: "Model returned no text content",
            sessionID,
            model,
          },
          null,
          2,
        )
      }

      // Strip optional markdown fences (model may wrap in ```json ... ```)
      const jsonText = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()

      let parsed: unknown
      try {
        parsed = JSON.parse(jsonText)
      } catch (err) {
        return JSON.stringify(
          {
            error: "Model response was not valid JSON",
            parseError: String(err),
            rawText,
            sessionID,
            model,
          },
          null,
          2,
        )
      }

      const reflection = reflectionFromJson(parsed, sessionID)
      const filePath = await writeDreamReflection(config.stateDir, sessionID, reflection)

      return JSON.stringify(
        {
          sessionID,
          model,
          reflectionFilePath: filePath,
          reflection,
        },
        null,
        2,
      )
    },
  })
}
