import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { importFileIntoDreamSessions } from "../src/opendream/fs-store.js"
import { createOpendreamExtMemSyncTool } from "../src/tools/opendream-ext-mem-sync.js"
import { createOpencodeDreamIngestGenericJsonlTool } from "../src/tools/opendream-ingest-generic-jsonl.js"

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

describe("phase 2 hardening", () => {
  it("keeps ext mem sync append mode idempotent across repeated non-dry-run writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase2-ext-idempotent-"))
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

    await tool.execute({
      sources: ["opencode-mem", "simple-memory"],
      opencodeMemUrl: "http://memory.test",
      simpleMemoryDir: memDir,
      mode: "append",
    })
    await tool.execute({
      sources: ["opencode-mem", "simple-memory"],
      opencodeMemUrl: "http://memory.test",
      simpleMemoryDir: memDir,
      mode: "append",
    })

    const memory = await readFile(config.memoryFile, "utf8")
    expect(memory.match(/<!-- opencode-mem:sync/g)?.length ?? 0).toBe(1)
    expect(memory.match(/<!-- simple-memory:sync/g)?.length ?? 0).toBe(1)
    expect(memory.match(/server memory/g)?.length ?? 0).toBe(1)
    expect(memory.match(/use pnpm/g)?.length ?? 0).toBe(1)
  })

  it("preserves successful source blocks when another source fails in non-dry-run append mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase2-ext-mixed-"))
    const memDir = join(root, ".opencode", "memory")
    await mkdir(memDir, { recursive: true })
    await writeFile(
      join(memDir, "2026-05-09.logfmt"),
      'ts=2026-05-09T10:00:00.000Z type=preference scope=user content="use pnpm"\n',
      "utf8",
    )

    const config = resolveDreamConfig(root, undefined)
    const tool = createOpendreamExtMemSyncTool(config) as unknown as {
      execute(args: Record<string, unknown>): Promise<string>
    }

    const raw = await tool.execute({
      sources: ["simple-memory", "true-mem"],
      simpleMemoryDir: memDir,
      trueMemDbPath: "/does-not-exist/memory.db",
      mode: "append",
    })
    const result = JSON.parse(raw) as { ok: boolean; sources: Record<string, { ok: boolean }> }
    const memory = await readFile(config.memoryFile, "utf8")

    expect(result.ok).toBe(true)
    expect(result.sources["simple-memory"]?.ok).toBe(true)
    expect(result.sources["true-mem"]?.ok).toBe(false)
    expect(memory).toContain("<!-- simple-memory:sync")
    expect(memory).toContain("use pnpm")
  })

  it("does not copy invalid generic jsonl files into state even when copyIntoStateDir is true", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase2-ingest-invalid-"))
    const inputPath = join(root, "invalid.jsonl")
    await writeFile(inputPath, "not-json\n", "utf8")

    const config = resolveDreamConfig(root, undefined)
    const tool = createOpencodeDreamIngestGenericJsonlTool(config) as unknown as {
      execute(args: Record<string, unknown>): Promise<string>
    }

    const raw = await tool.execute({ filePath: inputPath, copyIntoStateDir: true })
    const result = JSON.parse(raw) as {
      copiedTo: string | null
      validation: { invalidLines: number; validLines: number }
    }

    expect(result.validation.invalidLines).toBeGreaterThan(0)
    expect(result.validation.validLines).toBe(0)
    expect(result.copiedTo).toBeNull()
    await expect(access(join(config.stateDir, "sessions", "imports", "invalid.jsonl"))).rejects.toThrow()
  })

  it("avoids overwriting existing imported sessions when source basenames collide", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase2-import-collision-"))
    const stateDir = join(root, ".opencode-dream")
    const sourceDirA = join(root, "src-a")
    const sourceDirB = join(root, "src-b")
    await mkdir(sourceDirA, { recursive: true })
    await mkdir(sourceDirB, { recursive: true })

    const sourceA = join(sourceDirA, "session.jsonl")
    const sourceB = join(sourceDirB, "session.jsonl")
    await writeFile(sourceA, `${JSON.stringify(makeSession({ task_description: "first" }))}\n`, "utf8")
    await writeFile(sourceB, `${JSON.stringify(makeSession({ task_description: "second" }))}\n`, "utf8")

    const firstDestination = await importFileIntoDreamSessions(stateDir, sourceA)
    const secondDestination = await importFileIntoDreamSessions(stateDir, sourceB)

    expect(firstDestination).not.toBe(secondDestination)
    expect(firstDestination).toBe(join(stateDir, "sessions", "imports", "session.jsonl"))
    expect(secondDestination).toBe(join(stateDir, "sessions", "imports", "session-1.jsonl"))
    await expect(readFile(firstDestination, "utf8")).resolves.toContain("first")
    await expect(readFile(secondDestination, "utf8")).resolves.toContain("second")
  })
})
