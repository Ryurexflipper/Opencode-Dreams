import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { processDreamEventCapture } from "../src/opendream/live-capture.js"

async function bootstrapSession(
  config: ReturnType<typeof resolveDreamConfig>,
  sessionID: string,
  title = "Phase 3 session",
) {
  await processDreamEventCapture(config, {
    type: "session.created",
    properties: {
      info: {
        id: sessionID,
        projectID: "proj-phase3",
        directory: config.stateDir,
        title,
        version: "1",
        time: { created: 1_000, updated: 1_000 },
      },
    },
  })
}

async function readSnapshot(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as {
    ended_at?: string
    outcome_known: boolean
    outcome_success?: boolean
    messages: Array<{
      index: number
      role: string
      content: string
      tool_name?: string
      tool_output?: string
    }>
    metadata: {
      unresolved_part_count: number
      captured_message_count: number
      last_error?: unknown
    }
  }
}

describe("Phase 3 hardening — terminal-state late events", () => {
  it("ignores late message and part updates after session.error", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase3-error-terminal-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-error-terminal")

    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-initial",
          sessionID: "session-error-terminal",
          role: "user",
          time: { created: 2_000 },
          agent: "build",
          model: { providerID: "github-copilot", modelID: "gpt-5.4" },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-initial",
          sessionID: "session-error-terminal",
          messageID: "msg-initial",
          type: "text",
          text: "before terminal error",
          time: { start: 3_000, end: 4_000 },
        },
      },
    })

    const terminal = await processDreamEventCapture(config, {
      type: "session.error",
      properties: {
        sessionID: "session-error-terminal",
        error: { name: "UnknownError", data: { message: "terminal failure" } },
      },
    })

    expect(terminal?.action).toBe("session-error-snapshot")

    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-late",
          sessionID: "session-error-terminal",
          role: "user",
          time: { created: 5_000 },
          agent: "build",
          model: { providerID: "github-copilot", modelID: "gpt-5.4" },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-late",
          sessionID: "session-error-terminal",
          messageID: "msg-late",
          type: "text",
          text: "should be ignored after terminal error",
          time: { start: 6_000, end: 7_000 },
        },
      },
    })

    const snapshot = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: { sessionID: "session-error-terminal" },
    })

    const saved = await readSnapshot(snapshot!.filePath!)
    expect(saved.outcome_known).toBe(true)
    expect(saved.outcome_success).toBe(false)
    expect(saved.messages).toHaveLength(1)
    expect(saved.messages[0]).toMatchObject({ role: "user", content: "before terminal error" })
    expect(saved.metadata.unresolved_part_count).toBe(0)
  })

  it("ignores late message parts after session.deleted", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase3-deleted-terminal-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-deleted-terminal")

    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-before-delete",
          sessionID: "session-deleted-terminal",
          role: "user",
          time: { created: 2_000 },
          agent: "build",
          model: { providerID: "github-copilot", modelID: "gpt-5.4" },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-before-delete",
          sessionID: "session-deleted-terminal",
          messageID: "msg-before-delete",
          type: "text",
          text: "captured before delete",
          time: { start: 3_000, end: 4_000 },
        },
      },
    })

    const terminal = await processDreamEventCapture(config, {
      type: "session.deleted",
      properties: {
        info: {
          id: "session-deleted-terminal",
          projectID: "proj-phase3",
          directory: root,
          title: "Deleted terminal session",
          version: "1",
          time: { created: 1_000, updated: 5_000 },
        },
      },
    })

    expect(terminal?.action).toBe("session-deleted-snapshot")

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-after-delete",
          sessionID: "session-deleted-terminal",
          messageID: "msg-after-delete",
          type: "text",
          text: "should be ignored after delete",
          time: { start: 6_000, end: 7_000 },
        },
      },
    })

    const snapshot = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: { sessionID: "session-deleted-terminal" },
    })

    const saved = await readSnapshot(snapshot!.filePath!)
    expect(saved.ended_at).toBeDefined()
    expect(saved.messages).toHaveLength(1)
    expect(saved.messages[0]).toMatchObject({ role: "user", content: "captured before delete" })
    expect(saved.metadata.unresolved_part_count).toBe(0)
  })
})

describe("Phase 3 hardening — multipart interleaving", () => {
  it("preserves original order while replacing same-part content across interleaved updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase3-interleave-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-interleave")

    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-assistant",
          sessionID: "session-interleave",
          role: "user",
          time: { created: 2_000 },
          agent: "build",
          model: { providerID: "github-copilot", modelID: "gpt-5.4" },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-1",
          sessionID: "session-interleave",
          messageID: "msg-assistant",
          type: "text",
          text: "draft response",
          time: { start: 3_000, end: 4_000 },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-1",
          sessionID: "session-interleave",
          messageID: "msg-assistant",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "running",
            title: "Run tests",
            input: { command: "npm test" },
            metadata: {},
            time: { start: 5_000 },
          },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-1",
          sessionID: "session-interleave",
          messageID: "msg-assistant",
          type: "text",
          text: "final response",
          time: { start: 3_000, end: 6_000 },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-1",
          sessionID: "session-interleave",
          messageID: "msg-assistant",
          type: "reasoning",
          text: "checked the updated output",
          time: { start: 7_000, end: 8_000 },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-1",
          sessionID: "session-interleave",
          messageID: "msg-assistant",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            title: "Run tests",
            output: "tests passed",
            input: { command: "npm test" },
            metadata: {},
            time: { start: 5_000, end: 9_000 },
          },
        },
      },
    })

    const snapshot = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: { sessionID: "session-interleave" },
    })

    const saved = await readSnapshot(snapshot!.filePath!)
    expect(saved.messages).toHaveLength(3)
    expect(saved.messages[0]).toMatchObject({
      index: 0,
      role: "user",
      content: "final response",
    })
    expect(saved.messages[1]).toMatchObject({
      index: 1,
      role: "tool",
      content: "tests passed",
      tool_name: "bash",
      tool_output: "tests passed",
      tool_input: { command: "npm test" },
    })
    expect(saved.messages[2]).toMatchObject({
      index: 2,
      role: "user",
      content: "[reasoning]\nchecked the updated output",
    })
    expect(saved.metadata.unresolved_part_count).toBe(0)
  })
})

describe("Phase 3 hardening — incomplete stream degradation", () => {
  it("keeps unresolved parts as unknown-role messages instead of dropping them", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase3-unresolved-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-unresolved")

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-unresolved",
          sessionID: "session-unresolved",
          messageID: "msg-missing-role",
          type: "text",
          text: "orphan text part",
          time: { start: 2_000, end: 3_000 },
        },
      },
    })

    await processDreamEventCapture(config, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-unresolved",
          sessionID: "session-unresolved",
          messageID: "msg-missing-role",
          type: "reasoning",
          text: "orphan reasoning part",
          time: { start: 4_000, end: 5_000 },
        },
      },
    })

    const snapshot = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: { sessionID: "session-unresolved" },
    })

    const saved = await readSnapshot(snapshot!.filePath!)
    expect(saved.messages).toHaveLength(2)
    expect(saved.messages[0]).toMatchObject({
      index: 0,
      role: "unknown",
      content: "orphan text part",
    })
    expect(saved.messages[1]).toMatchObject({
      index: 1,
      role: "unknown",
      content: "[reasoning]\norphan reasoning part",
    })
    expect(saved.metadata.unresolved_part_count).toBe(2)
    expect(saved.metadata.captured_message_count).toBe(2)
  })
})
