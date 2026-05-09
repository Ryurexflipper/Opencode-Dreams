import { tool } from "@opencode-ai/plugin"

import { readGenericJsonlSessionFile } from "../opendream/generic-jsonl.js"
import { renderDreamReflectionPrompt, resolveDreamSessionID } from "../opendream/reflection.js"

export function createOpencodeDreamReflectPromptTool() {
  return tool({
    description: "Renders the Stage 1 reflection prompt for a saved OpenDream-style session snapshot",
    args: {
      sessionFilePath: tool.schema.string().describe("Path to a saved session .jsonl file"),
      maxMessageChars: tool.schema.number().int().positive().optional().describe("Optional per-message truncation limit"),
    },
    async execute(args) {
      const session = await readGenericJsonlSessionFile(args.sessionFilePath)
      const prompt = renderDreamReflectionPrompt(session, { maxMessageChars: args.maxMessageChars })

      return JSON.stringify(
        {
          sessionID: resolveDreamSessionID(session, args.sessionFilePath),
          taskDescription: session.task_description ?? null,
          system: prompt.system,
          user: prompt.user,
        },
        null,
        2,
      )
    },
  })
}
