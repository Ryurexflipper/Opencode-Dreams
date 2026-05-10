import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { readReflectionFile } from "../src/opendream/dream.js"
import { ensureDreamLayout } from "../src/opendream/fs-store.js"
import { createOpencodeDreamExportAgentsTool } from "../src/tools/opendream-export-agents.js"
import { createOpendreamExtMemSyncTool } from "../src/tools/opendream-ext-mem-sync.js"
import { createOpencodeDreamMemoryApplyTool } from "../src/tools/opendream-memory-apply.js"
import { createOpencodeDreamReflectBatchTool } from "../src/tools/opendream-reflect-batch.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent: "build",
    started_at: "2026-05-09T00:00:00.000Z",
    task_description: "Investigate issue",
    messages: [{ index: 0, role: "user", content: "hello" }],
    ...overrides,
  }
}

function makeStoredConsolidation(id: string, content: string): Record<string, unknown> {
  return {
    id,
    created_at: "2026-05-09T00:00:00.000Z",
    session_count: 1,
    reflection_ids: ["reflection-1"],
    themes: [],
    memory_entries: [
      {
        kind: "workflow",
        content,
        confidence: "high",
        scope: "generalizable",
        source_sessions: ["session-1"],
      },
    ],
    synthesis_notes: null,
  }
}

describe("self-healing regressions", () => {
  it("preserves multiple successful source blocks during ext mem sync replace dry-run", async () => {
    const root = await mkdtemp(join(tmpdir(), "self-heal-ext-sync-"))
    const memDir = join(root, ".opencode", "memory")
    await mkdir(memDir, { recursive: true })
    await writeFile(
      join(memDir, "2026-05-09.logfmt"),
      'ts=2026-05-09T10:00:00.000Z type=preference scope=user content="use pnpm"\n',
      "utf8",
    )

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: { items: [{ id: "mem-1", type: "memory", content: "server memory" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })),
    )

    const config = resolveDreamConfig(root, undefined)
    const tool = createOpendreamExtMemSyncTool(config) as unknown as {
      execute(args: Record<string, unknown>): Promise<string>
    }

    const raw = await tool.execute({
      sources: ["opencode-mem", "simple-memory"],
      opencodeMemUrl: "http://memory.test",
      simpleMemoryDir: memDir,
      mode: "replace",
      dryRun: true,
    })
    const result = JSON.parse(raw) as { ok: boolean; previewContent: string }

    expect(result.ok).toBe(true)
    expect(result.previewContent).toContain("<!-- opencode-mem:sync")
    expect(result.previewContent).toContain("server memory")
    expect(result.previewContent).toContain("<!-- simple-memory:sync")
    expect(result.previewContent).toContain("use pnpm")
  })

  it("allows reflect batch dry-run without a configured model", async () => {
    const previousReflectModel = process.env.OPENCODE_DREAM_REFLECT_MODEL
    delete process.env.OPENCODE_DREAM_REFLECT_MODEL

    const root = await mkdtemp(join(tmpdir(), "self-heal-reflect-dryrun-"))
    try {
      const config = resolveDreamConfig(root, { preferredReflectModel: undefined })
      await ensureDreamLayout(config.stateDir)
      const sessionFile = join(config.stateDir, "sessions", "imports", "pending.jsonl")
      await writeFile(sessionFile, `${JSON.stringify(makeSession())}\n`, "utf8")

      const tool = createOpencodeDreamReflectBatchTool(config, {} as never) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({ dryRun: true })
      const result = JSON.parse(raw) as { dryRun: boolean; pendingCount: number; pendingFiles: string[] }

      expect(result.dryRun).toBe(true)
      expect(result.pendingCount).toBe(1)
      expect(result.pendingFiles).toContain(sessionFile)
    } finally {
      if (previousReflectModel === undefined) {
        delete process.env.OPENCODE_DREAM_REFLECT_MODEL
      } else {
        process.env.OPENCODE_DREAM_REFLECT_MODEL = previousReflectModel
      }
    }
  })

  it("dedupes reflect batch against metadata-derived session ids", async () => {
    const previousReflectModel = process.env.OPENCODE_DREAM_REFLECT_MODEL
    delete process.env.OPENCODE_DREAM_REFLECT_MODEL

    const root = await mkdtemp(join(tmpdir(), "self-heal-reflect-dedupe-"))
    try {
      const config = resolveDreamConfig(root, { preferredReflectModel: undefined })
      await ensureDreamLayout(config.stateDir)

      const sessionFile = join(config.stateDir, "sessions", "imports", "different-name.jsonl")
      await writeFile(
        sessionFile,
        `${JSON.stringify(makeSession({ metadata: { opendream_session_id: "resolved-session" } }))}\n`,
        "utf8",
      )
      await writeFile(join(config.stateDir, "reflections", "resolved-session.json"), "{}\n", "utf8")

      const tool = createOpencodeDreamReflectBatchTool(config, {} as never) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({ dryRun: true })
      const result = JSON.parse(raw) as { dryRun?: boolean; pendingCount?: number; message?: string }

      expect(result.pendingCount ?? 0).toBe(0)
      expect(result.message ?? "").toMatch(/Nothing to process|already have reflections/i)
    } finally {
      if (previousReflectModel === undefined) {
        delete process.env.OPENCODE_DREAM_REFLECT_MODEL
      } else {
        process.env.OPENCODE_DREAM_REFLECT_MODEL = previousReflectModel
      }
    }
  })

  it("selects the latest consolidation by mtime when no path is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "self-heal-memory-latest-"))
    const config = resolveDreamConfig(root, undefined)
    await ensureDreamLayout(config.stateDir)

    const olderPath = join(config.stateDir, "dreams", "older.json")
    const newerPath = join(config.stateDir, "dreams", "newer.json")
    await writeFile(olderPath, `${JSON.stringify(makeStoredConsolidation("older", "older memory"), null, 2)}\n`, "utf8")
    await writeFile(newerPath, `${JSON.stringify(makeStoredConsolidation("newer", "newer memory"), null, 2)}\n`, "utf8")
    await utimes(olderPath, new Date("2026-05-09T00:00:00.000Z"), new Date("2026-05-09T00:00:00.000Z"))
    await utimes(newerPath, new Date("2026-05-10T00:00:00.000Z"), new Date("2026-05-10T00:00:00.000Z"))

    const tool = createOpencodeDreamMemoryApplyTool(config) as unknown as {
      execute(args: Record<string, unknown>): Promise<string>
    }

    const raw = await tool.execute({ dryRun: true })
    const result = JSON.parse(raw) as { consolidationFilePath: string; previewContent: string }

    expect(result.consolidationFilePath).toBe(newerPath)
    expect(result.previewContent).toContain("newer memory")
    expect(result.previewContent).not.toContain("older memory")
  })

  it("returns a clear error for malformed stored consolidations", async () => {
    const root = await mkdtemp(join(tmpdir(), "self-heal-memory-invalid-"))
    const config = resolveDreamConfig(root, undefined)
    await ensureDreamLayout(config.stateDir)

    const badPath = join(config.stateDir, "dreams", "bad.json")
    await writeFile(badPath, `${JSON.stringify({ id: "bad", session_count: 1 })}\n`, "utf8")

    const tool = createOpencodeDreamMemoryApplyTool(config) as unknown as {
      execute(args: Record<string, unknown>): Promise<string>
    }

    const raw = await tool.execute({ consolidationFilePath: badPath, dryRun: true })
    const result = JSON.parse(raw) as { error: string }

    expect(result.error).toMatch(/Invalid consolidation file/i)
  })

  it("rejects malformed stored reflection objects early", async () => {
    const root = await mkdtemp(join(tmpdir(), "self-heal-reflection-load-"))
    const filePath = join(root, "bad-reflection.json")
    await writeFile(filePath, `${JSON.stringify({ session_id: "session-1" })}\n`, "utf8")

    await expect(readReflectionFile(filePath)).rejects.toThrow(/session_completeness/)
  })

  it("uses the same managed block structure in export-agents dry-run previews", async () => {
    const root = await mkdtemp(join(tmpdir(), "self-heal-export-preview-"))
    const config = resolveDreamConfig(root, undefined)
    await ensureDreamLayout(config.stateDir)
    await writeFile(config.memoryFile, "- remembered guidance\n", "utf8")

    const tool = createOpencodeDreamExportAgentsTool(config) as unknown as {
      execute(args: Record<string, unknown>): Promise<string>
    }

    const raw = await tool.execute({ dryRun: true })
    const result = JSON.parse(raw) as { previewFragment: string }

    expect(result.previewFragment).toContain("Managed by the Opencode-Dream plugin scaffold")
    expect(result.previewFragment).toContain("remembered guidance")
  })
})
