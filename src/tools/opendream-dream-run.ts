import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"

import type { DreamResolvedConfig } from "../config.js"
import { readDreamEnvironment } from "../env.js"
import { readCurrentMemory } from "../opendream/fs-store.js"
import { listReflectionFiles, writeDreamConsolidation } from "../opendream/dream-store.js"
import { consolidationFromJson, renderDreamConsolidationPrompt } from "../opendream/dream.js"
import { readReflectionFile } from "../opendream/dream.js"

function resolveModel(
  override: string | undefined,
  config: DreamResolvedConfig,
): { providerID: string; modelID: string } {
  const raw = override ?? config.preferredDreamModel ?? readDreamEnvironment().dreamModel
  if (!raw) {
    throw new Error(
      "No dream model configured. Provide modelOverride, set preferredDreamModel in plugin options, or set OPENCODE_DREAM_DREAM_MODEL.",
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

export function createOpencodeDreamRunTool(
  config: DreamResolvedConfig,
  client: PluginInput["client"],
) {
  return tool({
    description:
      "Stage 2: Reads all stored reflections, synthesizes them with existing memory via LLM, and saves a new dream consolidation to the dreams/ directory. This is the core memory consolidation step.",
    args: {
      modelOverride: tool.schema
        .string()
        .optional()
        .describe(
          "Model to use in providerID/modelID format. Defaults to plugin config or OPENCODE_DREAM_DREAM_MODEL.",
        ),
      reflectionFilePaths: tool.schema
        .string()
        .optional()
        .describe(
          "Comma-separated list of specific reflection file paths to consolidate. Defaults to all reflections in the reflections/ directory.",
        ),
      maxMessageChars: tool.schema
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional per-candidate truncation limit in the consolidation prompt"),
    },
    async execute(args) {
      const model = resolveModel(args.modelOverride, config)

      // Resolve which reflection files to use
      const filePaths: string[] = args.reflectionFilePaths
        ? args.reflectionFilePaths.split(",").map((s) => s.trim()).filter(Boolean)
        : await listReflectionFiles(config.stateDir)

      if (filePaths.length === 0) {
        return JSON.stringify(
          { error: "No reflection files found. Run opendream_reflect_run first.", stateDir: config.stateDir },
          null,
          2,
        )
      }

      // Load all reflections
      const reflections = await Promise.all(filePaths.map((fp) => readReflectionFile(fp)))

      // Load existing memory
      let existingMemory = ""
      try {
        existingMemory = await readCurrentMemory(config.stateDir)
      } catch {
        // memory may not exist yet — that's fine
      }

      const prompt = renderDreamConsolidationPrompt(reflections, existingMemory)

      // Create ephemeral session for the model call
      const created = await client.session.create({
        body: { title: `opendream-dream:${reflections.length}-reflections` },
      })
      const ephemeralID = created.data?.id
      if (!ephemeralID) {
        throw new Error("Failed to create ephemeral session for dream execution")
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

      if (!rawText.trim()) {
        return JSON.stringify(
          { error: "Model returned no text content", model, reflectionCount: reflections.length },
          null,
          2,
        )
      }

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
            model,
          },
          null,
          2,
        )
      }

      const consolidation = consolidationFromJson(parsed, reflections)
      const filePath = await writeDreamConsolidation(config.stateDir, consolidation)

      return JSON.stringify(
        {
          model,
          reflectionCount: reflections.length,
          themeCount: consolidation.themes.length,
          memoryEntryCount: consolidation.memory_entries.length,
          consolidationFilePath: filePath,
          consolidation,
        },
        null,
        2,
      )
    },
  })
}
