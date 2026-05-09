/**
 * Integration tests for external memory adapters:
 *   - opencode-mem (HTTP client / render / merge)
 *   - simple-memory (logfmt parser / render / merge)
 *   - true-mem (file-not-found error path)
 *   - opencode-lcm (file-not-found error path)
 *   - opendream_ext_mem_sync unified tool (dryRun path)
 */

import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtemp } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import {
  fetchOpencodeMemItems,
  mergeOpencodeMemSection,
  renderOpencodeMemSection,
  type OpencodeMemItem,
} from "../src/integrations/opencode-mem.js"
import {
  parseLogfmt,
  fetchSimpleMemoryItems,
  renderSimpleMemorySection,
  mergeSimpleMemorySection,
  type SimpleMemoryItem,
} from "../src/integrations/simple-memory.js"
import { fetchTrueMemItems, renderTrueMemSection, mergeTrueMemSection } from "../src/integrations/true-mem.js"
import { fetchLcmItems, renderLcmSection, mergeLcmSection } from "../src/integrations/opencode-lcm.js"
import { resolveDreamConfig } from "../src/config.js"
import { createOpendreamExtMemSyncTool } from "../src/tools/opendream-ext-mem-sync.js"

// ─────────────────────────────────────────────────────────────────────────────
// opencode-mem
// ─────────────────────────────────────────────────────────────────────────────

describe("opencode-mem integration", () => {
  it("fetchOpencodeMemItems returns ok:false for unreachable server", async () => {
    const result = await fetchOpencodeMemItems("http://127.0.0.1:19999")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/Network error|ECONNREFUSED|fetch/i)
    }
  })

  it("renderOpencodeMemSection produces tagged markdown block", () => {
    const items: OpencodeMemItem[] = [
      { id: "mem_001", type: "memory", content: "Always run typecheck before build." },
      { id: "mem_002", type: "memory", content: "Use pnpm, not npm." },
    ]
    const section = renderOpencodeMemSection(items, { sourceUrl: "http://localhost:4747" })

    expect(section).toContain("<!-- opencode-mem:sync")
    expect(section).toContain("<!-- /opencode-mem:sync -->")
    expect(section).toContain("mem_001")
    expect(section).toContain("Always run typecheck before build.")
    expect(section).toContain("Use pnpm, not npm.")
    expect(section).toContain("count=\"2\"")
  })

  it("renderOpencodeMemSection truncates long items", () => {
    const longContent = "x".repeat(2000)
    const items: OpencodeMemItem[] = [{ id: "mem_long", type: "memory", content: longContent }]
    const section = renderOpencodeMemSection(items, { maxItemLength: 100 })

    expect(section).toContain("…")
    // Should not contain the full 2000 chars
    expect(section).not.toContain(longContent)
  })

  it("mergeOpencodeMemSection appends when no existing block", () => {
    const existing = "# Memory\n\nSome existing content.\n"
    const newSection = "<!-- opencode-mem:sync ts=\"x\" count=\"1\" source=\"s\" -->\n## section\n\n<!-- /opencode-mem:sync -->"

    const result = mergeOpencodeMemSection(existing, newSection, "append")
    expect(result).toContain("Some existing content.")
    expect(result).toContain("<!-- opencode-mem:sync")
  })

  it("mergeOpencodeMemSection replaces existing block on re-sync", () => {
    const existing = [
      "# Memory\n",
      "<!-- opencode-mem:sync ts=\"old\" count=\"1\" source=\"s\" -->",
      "## old section",
      "- old item",
      "<!-- /opencode-mem:sync -->",
      "## Other section\n",
    ].join("\n")

    const newSection = "<!-- opencode-mem:sync ts=\"new\" count=\"1\" source=\"s\" -->\n## new\n\n- new item\n\n<!-- /opencode-mem:sync -->"
    const result = mergeOpencodeMemSection(existing, newSection, "append")

    expect(result).not.toContain("old item")
    expect(result).toContain("new item")
    expect(result).toContain("## Other section")
  })

  it("mergeOpencodeMemSection replace mode overwrites entire content", () => {
    const existing = "# Memory\n\nOld stuff.\n"
    const newSection = "<!-- opencode-mem:sync ts=\"x\" count=\"0\" source=\"s\" -->\n<!-- /opencode-mem:sync -->"

    const result = mergeOpencodeMemSection(existing, newSection, "replace")
    expect(result).not.toContain("Old stuff")
    expect(result).toContain("<!-- opencode-mem:sync")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// simple-memory
// ─────────────────────────────────────────────────────────────────────────────

describe("simple-memory integration", () => {
  it("parseLogfmt parses a basic line", () => {
    const line = `ts=2026-05-09T12:00:00.000Z type=decision scope=user content="run typecheck first"`
    const items = parseLogfmt(line, "2026-05-09.logfmt")

    expect(items).toHaveLength(1)
    expect(items[0].type).toBe("decision")
    expect(items[0].scope).toBe("user")
    expect(items[0].content).toBe("run typecheck first")
    expect(items[0].ts).toBe("2026-05-09T12:00:00.000Z")
  })

  it("parseLogfmt handles escaped quotes in content", () => {
    const line = `ts=2026-05-09T00:00:00.000Z type=learning content="use \\"pnpm\\" not npm"`
    const items = parseLogfmt(line)

    expect(items).toHaveLength(1)
    expect(items[0].content).toBe('use "pnpm" not npm')
  })

  it("parseLogfmt skips lines without content field", () => {
    const lines = [
      `ts=2026-05-09T00:00:00.000Z type=decision scope=user`,
      `ts=2026-05-09T00:00:00.000Z type=learning content="valid"`,
    ].join("\n")

    const items = parseLogfmt(lines)
    expect(items).toHaveLength(1)
    expect(items[0].content).toBe("valid")
  })

  it("parseLogfmt skips comment lines", () => {
    const lines = `# this is a comment\nts=2026-05-09T00:00:00.000Z type=learning content="test"`
    const items = parseLogfmt(lines)
    expect(items).toHaveLength(1)
  })

  it("fetchSimpleMemoryItems returns ok:false for missing directory", async () => {
    const result = await fetchSimpleMemoryItems("/does-not-exist/opencode/memory")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/not found/i)
    }
  })

  it("fetchSimpleMemoryItems reads logfmt files from temp directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "simplemem-test-"))
    const memDir = join(root, ".opencode", "memory")
    await mkdir(memDir, { recursive: true })

    const logfmtContent = [
      `ts=2026-05-09T10:00:00.000Z type=decision scope=user content="prefer pnpm"`,
      `ts=2026-05-09T10:01:00.000Z type=learning scope=user content="run tests before commit"`,
    ].join("\n")

    await writeFile(join(memDir, "2026-05-09.logfmt"), logfmtContent + "\n", "utf8")

    const result = await fetchSimpleMemoryItems(memDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items).toHaveLength(2)
      expect(result.items[0].type).toBe("decision")
      expect(result.items[1].type).toBe("learning")
    }
  })

  it("fetchSimpleMemoryItems returns empty items for empty directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "simplemem-empty-"))
    const memDir = join(root, ".opencode", "memory")
    await mkdir(memDir, { recursive: true })

    const result = await fetchSimpleMemoryItems(memDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.items).toHaveLength(0)
    }
  })

  it("renderSimpleMemorySection groups by type and produces tagged block", () => {
    const items: SimpleMemoryItem[] = [
      { id: "1", ts: "2026-05-09T00:00:00Z", type: "decision", scope: "user", content: "use pnpm", sourceFile: "f" },
      { id: "2", ts: "2026-05-09T00:00:00Z", type: "learning", scope: "user", content: "run typecheck", sourceFile: "f" },
      { id: "3", ts: "2026-05-09T00:00:00Z", type: "decision", scope: "user", content: "write tests", sourceFile: "f" },
    ]
    const section = renderSimpleMemorySection(items)

    expect(section).toContain("<!-- simple-memory:sync")
    expect(section).toContain("<!-- /simple-memory:sync -->")
    expect(section).toContain("### Decision")
    expect(section).toContain("### Learning")
    expect(section).toContain("use pnpm")
    expect(section).toContain("run typecheck")
    expect(section).toContain("count=\"3\"")
  })

  it("mergeSimpleMemorySection appends when no existing block", () => {
    const existing = "# Memory\n\nOld stuff.\n"
    const newSection = "<!-- simple-memory:sync ts=\"x\" count=\"1\" source=\"s\" -->\n## s\n<!-- /simple-memory:sync -->"
    const result = mergeSimpleMemorySection(existing, newSection, "append")

    expect(result).toContain("Old stuff.")
    expect(result).toContain("<!-- simple-memory:sync")
  })

  it("mergeSimpleMemorySection replaces existing block", () => {
    const existing = [
      "# Memory\n",
      "<!-- simple-memory:sync ts=\"old\" count=\"1\" source=\"s\" -->",
      "old content",
      "<!-- /simple-memory:sync -->",
      "## Other\n",
    ].join("\n")

    const newSection = "<!-- simple-memory:sync ts=\"new\" count=\"0\" source=\"s\" -->\nnew content\n<!-- /simple-memory:sync -->"
    const result = mergeSimpleMemorySection(existing, newSection, "append")

    expect(result).not.toContain("old content")
    expect(result).toContain("new content")
    expect(result).toContain("## Other")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// true-mem (file-not-found path only — no SQLite bindings needed in tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("true-mem integration", () => {
  it("fetchTrueMemItems returns ok:false for missing database", async () => {
    const result = await fetchTrueMemItems("/does-not-exist/.true-mem/memory.db")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/not found/i)
    }
  })

  it("fetchTrueMemItems returns ok:false for non-SQLite file", async () => {
    const root = await mkdtemp(join(tmpdir(), "truemem-test-"))
    const fakeDb = join(root, "notasqlite.db")
    await writeFile(fakeDb, "this is not a sqlite file", "utf8")

    const result = await fetchTrueMemItems(fakeDb)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/SQLite|database/i)
    }
  })

  it("renderTrueMemSection produces tagged block with classification groups", () => {
    const items = [
      { id: "truemem-1", classification: "preference", summary: "prefer pnpm", strength: 0.9, projectScope: null, store: "LTM" as const },
      { id: "truemem-2", classification: "learning", summary: "typecheck first", strength: 0.8, projectScope: null, store: "LTM" as const },
      { id: "truemem-3", classification: "preference", summary: "no semicolons", strength: 0.7, projectScope: null, store: "STM" as const },
    ]
    const section = renderTrueMemSection(items)

    expect(section).toContain("<!-- true-mem:sync")
    expect(section).toContain("<!-- /true-mem:sync -->")
    expect(section).toContain("### Preference")
    expect(section).toContain("### Learning")
    expect(section).toContain("prefer pnpm")
    expect(section).toContain("typecheck first")
    expect(section).toContain("store: STM")
  })

  it("mergeTrueMemSection appends when no existing block", () => {
    const existing = "# Memory\n\nOld stuff.\n"
    const newSection = "<!-- true-mem:sync ts=\"x\" count=\"1\" source=\"s\" -->\n## s\n<!-- /true-mem:sync -->"
    const result = mergeTrueMemSection(existing, newSection, "append")

    expect(result).toContain("Old stuff.")
    expect(result).toContain("<!-- true-mem:sync")
  })

  it("mergeTrueMemSection replaces existing block", () => {
    const existing = [
      "# Memory",
      "<!-- true-mem:sync ts=\"old\" count=\"1\" source=\"s\" -->",
      "old data",
      "<!-- /true-mem:sync -->",
      "## Keep this",
    ].join("\n")

    const newSection = "<!-- true-mem:sync ts=\"new\" count=\"0\" source=\"s\" -->\nnew data\n<!-- /true-mem:sync -->"
    const result = mergeTrueMemSection(existing, newSection, "append")

    expect(result).not.toContain("old data")
    expect(result).toContain("new data")
    expect(result).toContain("## Keep this")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// opencode-lcm (file-not-found path only)
// ─────────────────────────────────────────────────────────────────────────────

describe("opencode-lcm integration", () => {
  it("fetchLcmItems returns ok:false for missing database", async () => {
    const result = await fetchLcmItems("/does-not-exist/.lcm/lcm.db")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/not found/i)
    }
  })

  it("fetchLcmItems returns ok:false for non-SQLite file", async () => {
    const root = await mkdtemp(join(tmpdir(), "lcm-test-"))
    const fakeDb = join(root, "fake.db")
    await writeFile(fakeDb, "not a sqlite file at all", "utf8")

    const result = await fetchLcmItems(fakeDb)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/SQLite|database/i)
    }
  })

  it("renderLcmSection produces tagged block with summaries and artifacts", () => {
    const summaries = [
      { id: "lcm-summary-1", sessionId: "sess-abc", content: "Fixed the auth bug.", createdAt: "2026-05-09T10:00:00Z" },
    ]
    const artifacts = [
      { id: "lcm-artifact-1", sessionId: "sess-abc", name: "auth-fix.ts", type: "code", content: "export function fix() {}", createdAt: "2026-05-09T10:00:00Z" },
    ]
    const section = renderLcmSection(summaries, artifacts)

    expect(section).toContain("<!-- opencode-lcm:sync")
    expect(section).toContain("<!-- /opencode-lcm:sync -->")
    expect(section).toContain("### Session Summaries")
    expect(section).toContain("Fixed the auth bug.")
    expect(section).toContain("### Artifacts")
    expect(section).toContain("auth-fix.ts")
    expect(section).toContain("count=\"2\"")
  })

  it("mergeLcmSection appends when no existing block", () => {
    const existing = "# Memory\n\nOld stuff.\n"
    const newSection = "<!-- opencode-lcm:sync ts=\"x\" count=\"1\" source=\"s\" -->\n## s\n<!-- /opencode-lcm:sync -->"
    const result = mergeLcmSection(existing, newSection, "append")

    expect(result).toContain("Old stuff.")
    expect(result).toContain("<!-- opencode-lcm:sync")
  })

  it("mergeLcmSection replaces existing block", () => {
    const existing = [
      "# Memory",
      "<!-- opencode-lcm:sync ts=\"old\" count=\"1\" source=\"s\" -->",
      "old lcm data",
      "<!-- /opencode-lcm:sync -->",
      "## Other",
    ].join("\n")

    const newSection = "<!-- opencode-lcm:sync ts=\"new\" count=\"0\" source=\"s\" -->\nnew lcm\n<!-- /opencode-lcm:sync -->"
    const result = mergeLcmSection(existing, newSection, "append")

    expect(result).not.toContain("old lcm data")
    expect(result).toContain("new lcm")
    expect(result).toContain("## Other")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// opendream_ext_mem_sync unified tool
// ─────────────────────────────────────────────────────────────────────────────

describe("opendream_ext_mem_sync tool", () => {
  it("returns ok:false when all sources fail (dryRun)", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-mem-sync-"))
    const config = resolveDreamConfig(root, {
      opencodeMem: { enabled: false, url: "http://127.0.0.1:19999" },
    })
    const tool = createOpendreamExtMemSyncTool(config)

    const raw = await (tool as unknown as { execute(args: Record<string, unknown>): Promise<string> }).execute({
      sources: ["opencode-mem"],
      dryRun: true,
    })
    const result = JSON.parse(raw) as { ok: boolean; sources: Record<string, unknown> }

    // Either no sections returned (ok: false) or source has error
    expect(result).toBeDefined()
    // The opencode-mem source should have failed
    expect(result.sources["opencode-mem"]).toBeDefined()
    const memResult = result.sources["opencode-mem"] as { ok: boolean }
    expect(memResult.ok).toBe(false)
  })

  it("handles missing SQLite sources gracefully (dryRun)", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-mem-sync-sqlite-"))
    const config = resolveDreamConfig(root, {
      opencodeMem: { enabled: false, url: "http://127.0.0.1:19999" },
    })
    const tool = createOpendreamExtMemSyncTool(config)

    const raw = await (tool as unknown as { execute(args: Record<string, unknown>): Promise<string> }).execute({
      sources: ["true-mem", "opencode-lcm"],
      trueMemDbPath: "/does-not-exist/memory.db",
      lcmDbPath: "/does-not-exist/lcm.db",
      dryRun: true,
    })
    const result = JSON.parse(raw) as { ok: boolean; sources: Record<string, unknown> }

    expect(result.sources["true-mem"]).toBeDefined()
    expect(result.sources["opencode-lcm"]).toBeDefined()
    const trueMemResult = result.sources["true-mem"] as { ok: boolean }
    const lcmResult = result.sources["opencode-lcm"] as { ok: boolean }
    expect(trueMemResult.ok).toBe(false)
    expect(lcmResult.ok).toBe(false)
  })

  it("integrates simple-memory from temp files (dryRun)", async () => {
    const root = await mkdtemp(join(tmpdir(), "ext-mem-sync-simple-"))
    const memDir = join(root, ".opencode", "memory")
    await mkdir(memDir, { recursive: true })

    await writeFile(
      join(memDir, "2026-05-09.logfmt"),
      `ts=2026-05-09T10:00:00.000Z type=preference scope=user content="use pnpm"\n`,
      "utf8",
    )

    const config = resolveDreamConfig(root, undefined)
    const tool = createOpendreamExtMemSyncTool(config)

    const raw = await (tool as unknown as { execute(args: Record<string, unknown>): Promise<string> }).execute({
      sources: ["simple-memory"],
      simpleMemoryDir: memDir,
      dryRun: true,
    })
    const result = JSON.parse(raw) as {
      ok: boolean
      dryRun: boolean
      previewContent: string
      sources: Record<string, unknown>
    }

    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.previewContent).toContain("use pnpm")
    expect(result.previewContent).toContain("<!-- simple-memory:sync")

    const simpleResult = result.sources["simple-memory"] as { ok: boolean; itemCount: number }
    expect(simpleResult.ok).toBe(true)
    expect(simpleResult.itemCount).toBe(1)
  })
})
