/**
 * Tests for the three opencode-dream hooks:
 *   - createDreamCompactionHook (hooks/compaction.ts)
 *   - createDreamShellEnvHook   (hooks/env.ts)
 *   - createDreamEventHook      (hooks/event.ts)
 */

import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { ensureDreamLayout } from "../src/opendream/fs-store.js"
import { createDreamCompactionHook } from "../src/hooks/compaction.js"
import { createDreamShellEnvHook } from "../src/hooks/env.js"
import { createDreamEventHook } from "../src/hooks/event.js"

// ---------------------------------------------------------------------------
// createDreamCompactionHook
// ---------------------------------------------------------------------------

describe("createDreamCompactionHook", () => {
  it("injects consolidated memory into context output", async () => {
    const root = await mkdtemp(join(tmpdir(), "compaction-hook-"))
    const config = resolveDreamConfig(root, undefined)
    await ensureDreamLayout(config.stateDir)
    await writeFile(
      join(config.stateDir, "memory", "current.md"),
      "## My consolidated memory\n\n- Always run typecheck first.",
      "utf8",
    )

    const hook = createDreamCompactionHook(config)
    const output = { context: [] as string[] }
    await hook({} as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1])

    expect(output.context).toHaveLength(1)
    expect(output.context[0]).toContain("Opencode-Dream consolidated memory")
    expect(output.context[0]).toContain("Always run typecheck first.")
  })

  it("skips injection when memory file contains only whitespace", async () => {
    const root = await mkdtemp(join(tmpdir(), "compaction-empty-"))
    const config = resolveDreamConfig(root, undefined)
    await ensureDreamLayout(config.stateDir)
    await writeFile(join(config.stateDir, "memory", "current.md"), "   \n\n  ", "utf8")

    const hook = createDreamCompactionHook(config)
    const output = { context: [] as string[] }
    await hook({} as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1])

    expect(output.context).toHaveLength(0)
  })

  it("silently skips when memory file does not exist (fresh state)", async () => {
    const root = await mkdtemp(join(tmpdir(), "compaction-fresh-"))
    // Intentionally do NOT call ensureDreamLayout — no memory file exists yet
    const config = resolveDreamConfig(root, undefined)

    const hook = createDreamCompactionHook(config)
    const output = { context: [] as string[] }

    // Must not throw
    await expect(
      hook({} as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1]),
    ).resolves.toBeUndefined()

    expect(output.context).toHaveLength(0)
  })

  it("prepends the plugin label to the injected block", async () => {
    const root = await mkdtemp(join(tmpdir(), "compaction-label-"))
    const config = resolveDreamConfig(root, undefined)
    await ensureDreamLayout(config.stateDir)
    await writeFile(
      join(config.stateDir, "memory", "current.md"),
      "- prefer pnpm over npm",
      "utf8",
    )

    const hook = createDreamCompactionHook(config)
    const output = { context: [] as string[] }
    await hook({} as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1])

    expect(output.context[0]).toMatch(/^## Opencode-Dream consolidated memory/)
  })
})

// ---------------------------------------------------------------------------
// createDreamShellEnvHook
// ---------------------------------------------------------------------------

describe("createDreamShellEnvHook", () => {
  it("sets all required env vars", async () => {
    const root = await mkdtemp(join(tmpdir(), "env-hook-"))
    const config = resolveDreamConfig(root, {
      preferredReflectModel: "github-copilot/gpt-5.4",
      preferredDreamModel: "github-copilot/gpt-5.4",
    })

    const hook = createDreamShellEnvHook(config)
    const output = { env: {} as Record<string, string> }
    await hook({} as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1])

    expect(output.env.OPENCODE_DREAM_ROOT).toBe(config.stateDir)
    expect(output.env.OPENCODE_DREAM_MEMORY_FILE).toBe(config.memoryFile)
    expect(output.env.OPENCODE_DREAM_AGENTS_FILE).toBe(config.agentsFile)
    expect(output.env.OPENCODE_DREAM_REFLECT_MODEL).toBe("github-copilot/gpt-5.4")
    expect(output.env.OPENCODE_DREAM_DREAM_MODEL).toBe("github-copilot/gpt-5.4")
  })

  it("omits model env vars when preferredReflectModel and preferredDreamModel are not set", async () => {
    const root = await mkdtemp(join(tmpdir(), "env-hook-nomodel-"))
    const config = resolveDreamConfig(root, undefined)

    const hook = createDreamShellEnvHook(config)
    const output = { env: {} as Record<string, string> }
    await hook({} as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1])

    expect(output.env.OPENCODE_DREAM_ROOT).toBe(config.stateDir)
    expect(output.env.OPENCODE_DREAM_MEMORY_FILE).toBe(config.memoryFile)
    expect(output.env.OPENCODE_DREAM_AGENTS_FILE).toBe(config.agentsFile)
    expect(Object.prototype.hasOwnProperty.call(output.env, "OPENCODE_DREAM_REFLECT_MODEL")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(output.env, "OPENCODE_DREAM_DREAM_MODEL")).toBe(false)
  })

  it("only sets reflect model env var when only preferredReflectModel is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "env-hook-reflect-only-"))
    const config = resolveDreamConfig(root, { preferredReflectModel: "anthropic/claude-3-5-sonnet" })

    const hook = createDreamShellEnvHook(config)
    const output = { env: {} as Record<string, string> }
    await hook({} as Parameters<typeof hook>[0], output as Parameters<typeof hook>[1])

    expect(output.env.OPENCODE_DREAM_REFLECT_MODEL).toBe("anthropic/claude-3-5-sonnet")
    expect(Object.prototype.hasOwnProperty.call(output.env, "OPENCODE_DREAM_DREAM_MODEL")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createDreamEventHook
// ---------------------------------------------------------------------------

describe("createDreamEventHook", () => {
  function makeStubClient() {
    return {
      app: {
        log: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Parameters<typeof createDreamEventHook>[1]
  }

  it("captures a session.created event without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "event-hook-create-"))
    const config = resolveDreamConfig(root, undefined)
    const client = makeStubClient()
    const hook = createDreamEventHook(config, client)

    await expect(
      hook({
        event: {
          type: "session.created",
          properties: {
            info: {
              id: "hook-session-1",
              projectID: "proj-hook",
              directory: root,
              title: "Hook test session",
              version: "1",
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        },
      } as Parameters<typeof hook>[0]),
    ).resolves.toBeUndefined()
  })

  it("does not invoke client.app.log for session.created (no filePath in result)", async () => {
    const root = await mkdtemp(join(tmpdir(), "event-hook-log-"))
    const config = resolveDreamConfig(root, undefined)
    const client = makeStubClient()
    const hook = createDreamEventHook(config, client)

    await hook({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "hook-session-log",
            projectID: "proj-log",
            directory: root,
            title: "Log test",
            version: "1",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      },
    } as Parameters<typeof hook>[0])

    // session.created returns action but no filePath, so logDreamEvent is not called
    expect((client as unknown as { app: { log: ReturnType<typeof vi.fn> } }).app.log).not.toHaveBeenCalled()
  })

  it("returns early without writing files when captureLiveSessions is false", async () => {
    const root = await mkdtemp(join(tmpdir(), "event-hook-disabled-"))
    const config = resolveDreamConfig(root, { captureLiveSessions: false })
    const client = makeStubClient()
    const hook = createDreamEventHook(config, client)

    await expect(
      hook({
        event: {
          type: "session.created",
          properties: {
            info: {
              id: "skip-session",
              projectID: "proj-skip",
              directory: root,
              title: "Should not capture",
              version: "1",
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        },
      } as Parameters<typeof hook>[0]),
    ).resolves.toBeUndefined()

    // Capture is disabled — nothing should have been logged
    expect((client as unknown as { app: { log: ReturnType<typeof vi.fn> } }).app.log).not.toHaveBeenCalled()
  })
})
