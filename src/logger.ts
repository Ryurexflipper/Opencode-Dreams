import type { PluginInput } from "@opencode-ai/plugin"

export async function logDreamEvent(
  client: PluginInput["client"],
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service: "opencode-dream",
        level,
        message,
        extra,
      },
    })
  } catch {
    const fallback = `[opencode-dream] ${message}`
    if (level === "error") {
      console.error(fallback, extra)
      return
    }
    if (level === "warn") {
      console.warn(fallback, extra)
      return
    }
    console.log(fallback, extra)
  }
}
