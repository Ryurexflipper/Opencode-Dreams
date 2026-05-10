/**
 * Edge-case tests for processDreamEventCapture (opendream/live-capture.ts):
 *   - captureLiveSessions = false → always null
 *   - unknown event type → null
 *   - session.updated  → updates metadata
 *   - session.error    → snapshot with outcome_success = false
 *   - session.deleted  → final snapshot with ended_at
 *   - message.part.updated with a completed tool part → tool message in snapshot
 *   - message.part.updated with unsupported part type → null
 *   - session.idle with no runtime state → null
 *   - fallback state created when no prior session.created event was received
 */

import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { processDreamEventCapture } from "../src/opendream/live-capture.js"

// ---------------------------------------------------------------------------
// Helper: bootstrap a session with session.created
// ---------------------------------------------------------------------------

async function bootstrapSession(
  config: ReturnType<typeof resolveDreamConfig>,
  sessionID: string,
  title = "Test session",
) {
  return processDreamEventCapture(config, {
    type: "session.created",
    properties: {
      info: {
        id: sessionID,
        projectID: "proj-test",
        directory: config.stateDir,
        title,
        version: "1",
        time: { created: 1_000, updated: 1_000 },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// captureLiveSessions = false
// ---------------------------------------------------------------------------

describe("processDreamEventCapture — captureLiveSessions disabled", () => {
  it("returns null for any event when captureLiveSessions is false", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-disabled-"))
    const config = resolveDreamConfig(root, { captureLiveSessions: false })

    const result = await processDreamEventCapture(config, {
      type: "session.created",
      properties: {
        info: {
          id: "no-capture",
          projectID: "p",
          directory: root,
          title: "Should not capture",
          version: "1",
          time: { created: 1, updated: 1 },
        },
      },
    })

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Unknown event types
// ---------------------------------------------------------------------------

describe("processDreamEventCapture — unknown events", () => {
  it("returns null for an unrecognised event type", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-unknown-"))
    const config = resolveDreamConfig(root, undefined)

    const result = await processDreamEventCapture(
      config,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { type: "session.custom.unknown" } as any,
    )

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// session.updated
// ---------------------------------------------------------------------------

describe("processDreamEventCapture — session.updated", () => {
  it("returns session-updated action after updating an existing session", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-updated-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-upd")

    const result = await processDreamEventCapture(config, {
      type: "session.updated",
      properties: {
        info: {
          id: "session-upd",
          projectID: "proj-updated",
          directory: root,
          title: "Updated task title",
          version: "2",
          time: { created: 1_000, updated: 2_000 },
        },
      },
    })

    expect(result?.action).toBe("session-updated")
    expect(result?.sessionID).toBe("session-upd")
  })

  it("creates a fallback state when session.updated arrives before session.created", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-updated-fallback-"))
    const config = resolveDreamConfig(root, undefined)

    // No session.created has been called — state must be bootstrapped from fallback
    const result = await processDreamEventCapture(config, {
      type: "session.updated",
      properties: {
        info: {
          id: "orphan-session",
          projectID: "proj-orphan",
          directory: root,
          title: "Orphan task",
          version: "1",
          time: { created: 1_000, updated: 1_000 },
        },
      },
    })

    expect(result?.action).toBe("session-updated")
    expect(result?.sessionID).toBe("orphan-session")
  })
})

// ---------------------------------------------------------------------------
// session.error
// ---------------------------------------------------------------------------

describe("processDreamEventCapture — session.error", () => {
  it("produces a snapshot with outcome_success=false and records the error", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-error-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-err")

    // Add a user message so the snapshot has content
    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-err",
          sessionID: "session-err",
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
          id: "part-err",
          sessionID: "session-err",
          messageID: "msg-err",
          type: "text",
          text: "running build",
          time: { start: 3_000, end: 4_000 },
        },
      },
    })

    const result = await processDreamEventCapture(config, {
      type: "session.error",
      properties: {
        sessionID: "session-err",
        error: { name: "UnknownError", data: { message: "Build failed: type error on line 42" } },
      },
    })

    expect(result?.action).toBe("session-error-snapshot")
    expect(result?.filePath).toBeDefined()

    const saved = JSON.parse(await readFile(result!.filePath!, "utf8")) as {
      outcome_known: boolean
      outcome_success: boolean
      metadata: { last_error: { name: string; data: { message: string } } }
    }
    expect(saved.outcome_known).toBe(true)
    expect(saved.outcome_success).toBe(false)
    expect(saved.metadata.last_error.data.message).toContain("Build failed")
  })

  it("returns null when session.error has no sessionID", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-error-nosid-"))
    const config = resolveDreamConfig(root, undefined)

    const result = await processDreamEventCapture(config, {
      type: "session.error",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: { error: "some error" } as any, // sessionID missing
    })

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// session.deleted
// ---------------------------------------------------------------------------

describe("processDreamEventCapture — session.deleted", () => {
  it("produces a final snapshot with ended_at set", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-deleted-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-del", "Deleted session")

    const result = await processDreamEventCapture(config, {
      type: "session.deleted",
      properties: {
        info: {
          id: "session-del",
          projectID: "proj-del",
          directory: root,
          title: "Deleted session",
          version: "1",
          time: { created: 1_000, updated: 2_000 },
        },
      },
    })

    expect(result?.action).toBe("session-deleted-snapshot")
    expect(result?.filePath).toContain("session-del.jsonl")

    const saved = JSON.parse(await readFile(result!.filePath!, "utf8")) as { ended_at: string }
    expect(typeof saved.ended_at).toBe("string")
    expect(saved.ended_at.length).toBeGreaterThan(0)
  })

  it("returns null when session.deleted has no matching runtime state", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-deleted-nostate-"))
    const config = resolveDreamConfig(root, undefined)

    const result = await processDreamEventCapture(config, {
      type: "session.deleted",
      properties: {
        info: {
          id: "ghost-session",
          projectID: "proj-ghost",
          directory: root,
          title: "Ghost",
          version: "1",
          time: { created: 1_000, updated: 1_000 },
        },
      },
    })

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// message.part.updated — tool part
// ---------------------------------------------------------------------------

describe("processDreamEventCapture — message.part.updated tool parts", () => {
  it("records tool name and output in the session snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-tool-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-tool")

    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-tool",
          sessionID: "session-tool",
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
          id: "part-tool",
          sessionID: "session-tool",
          messageID: "msg-tool",
          type: "tool",
          callID: "call-tool",
          tool: "bash",
          state: {
            status: "completed",
            title: "Run tests",
            output: "All tests passed.",
            input: { command: "pnpm test" },
            metadata: {},
            time: { start: 3_000, end: 4_000 },
          },
        },
      },
    })

    // Flush a snapshot via session.idle
    const snapshot = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: { sessionID: "session-tool" },
    })

    expect(snapshot?.filePath).toBeDefined()
    const saved = JSON.parse(await readFile(snapshot!.filePath!, "utf8")) as {
      messages: Array<{ role: string; tool_name?: string; tool_output?: string }>
    }
    const toolMsg = saved.messages.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.tool_name).toBe("bash")
    expect(toolMsg?.tool_output).toBe("All tests passed.")
  })

  it("records a tool part in error state with the error text", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-tool-err-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-tool-err")

    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-terr",
          sessionID: "session-tool-err",
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
          id: "part-terr",
          sessionID: "session-tool-err",
          messageID: "msg-terr",
          type: "tool",
          callID: "call-terr",
          tool: "bash",
          state: {
            status: "error",
            error: "Command not found: pnpm",
            input: {},
            time: { start: 3_000, end: 4_000 },
          },
        },
      },
    })

    const snapshot = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: { sessionID: "session-tool-err" },
    })

    const saved = JSON.parse(await readFile(snapshot!.filePath!, "utf8")) as {
      messages: Array<{ role: string; tool_output?: string }>
    }
    const toolMsg = saved.messages.find((m) => m.role === "tool")
    expect(toolMsg?.tool_output).toContain("Command not found")
  })

  it("returns null for an unsupported part type (e.g. image)", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-unsupported-"))
    const config = resolveDreamConfig(root, undefined)

    const result = await processDreamEventCapture(
      config,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-img",
            sessionID: "session-xyz",
            messageID: "msg-xyz",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            type: "image" as any,
            time: { start: 1, end: 2 },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    )

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// session.idle
// ---------------------------------------------------------------------------

describe("processDreamEventCapture — session.idle", () => {
  it("returns null when no runtime state exists for the session", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-idle-nostate-"))
    const config = resolveDreamConfig(root, undefined)

    const result = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: { sessionID: "nonexistent-session" },
    })

    expect(result).toBeNull()
  })

  it("includes unresolved_part_count=0 in metadata when all parts have known roles", async () => {
    const root = await mkdtemp(join(tmpdir(), "capture-idle-clean-"))
    const config = resolveDreamConfig(root, undefined)
    await bootstrapSession(config, "session-clean")

    await processDreamEventCapture(config, {
      type: "message.updated",
      properties: {
        info: {
          id: "msg-clean",
          sessionID: "session-clean",
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
          id: "part-clean",
          sessionID: "session-clean",
          messageID: "msg-clean",
          type: "text",
          text: "clean message",
          time: { start: 3_000, end: 4_000 },
        },
      },
    })

    const snapshot = await processDreamEventCapture(config, {
      type: "session.idle",
      properties: { sessionID: "session-clean" },
    })

    const saved = JSON.parse(await readFile(snapshot!.filePath!, "utf8")) as {
      metadata: { unresolved_part_count: number }
    }
    expect(saved.metadata.unresolved_part_count).toBe(0)
  })
})
