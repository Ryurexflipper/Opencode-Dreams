/**
 * Tests for:
 *   - ensureDreamLayout   (opendream/fs-store.ts)
 *   - readCurrentMemory   (opendream/fs-store.ts)
 *   - summarizeDreamState (opendream/fs-store.ts)
 *   - resolveDreamConfig custom options (config.ts)
 *   - exportDreamManagedSection (opendream/agents-md.ts)
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { ensureDreamLayout, readCurrentMemory, summarizeDreamState } from "../src/opendream/fs-store.js"
import { exportDreamManagedSection } from "../src/opendream/agents-md.js"
import { DREAM_DIRECTORIES } from "../src/opendream/constants.js"

// ---------------------------------------------------------------------------
// ensureDreamLayout
// ---------------------------------------------------------------------------

describe("ensureDreamLayout", () => {
  it("creates all required subdirectories", async () => {
    const root = await mkdtemp(join(tmpdir(), "layout-dirs-"))
    const stateDir = join(root, ".opencode-dream")

    const result = await ensureDreamLayout(stateDir)

    expect(result.root).toBe(stateDir)
    for (const relDir of DREAM_DIRECTORIES) {
      expect(result.createdDirectories).toContain(join(stateDir, relDir))
    }
  })

  it("creates memory/current.md placeholder file on first call", async () => {
    const root = await mkdtemp(join(tmpdir(), "layout-memory-"))
    const stateDir = join(root, ".opencode-dream")

    const result = await ensureDreamLayout(stateDir)

    expect(result.createdFiles.some((f) => f.endsWith("current.md"))).toBe(true)
    const content = await readFile(join(stateDir, "memory", "current.md"), "utf8")
    expect(content).toContain("Opencode-Dream consolidated memory")
    expect(content).toContain("placeholder")
  })

  it("creates docs/README.md on first call", async () => {
    const root = await mkdtemp(join(tmpdir(), "layout-docs-"))
    const stateDir = join(root, ".opencode-dream")

    await ensureDreamLayout(stateDir)

    const content = await readFile(join(stateDir, "docs", "README.md"), "utf8")
    expect(content).toContain(".opencode-dream state")
    expect(content).toContain("sessions/")
    expect(content).toContain("memory/current.md")
  })

  it("is idempotent — second call creates no new directories or files", async () => {
    const root = await mkdtemp(join(tmpdir(), "layout-idempotent-"))
    const stateDir = join(root, ".opencode-dream")

    await ensureDreamLayout(stateDir)
    const second = await ensureDreamLayout(stateDir)

    expect(second.createdDirectories).toHaveLength(0)
    expect(second.createdFiles).toHaveLength(0)
  })

  it("does not overwrite an existing memory/current.md", async () => {
    const root = await mkdtemp(join(tmpdir(), "layout-no-overwrite-"))
    const stateDir = join(root, ".opencode-dream")

    await ensureDreamLayout(stateDir)
    const customContent = "## My custom memory\n\n- Do not overwrite me.\n"
    await writeFile(join(stateDir, "memory", "current.md"), customContent, "utf8")

    await ensureDreamLayout(stateDir)

    const content = await readFile(join(stateDir, "memory", "current.md"), "utf8")
    expect(content).toBe(customContent)
  })
})

// ---------------------------------------------------------------------------
// readCurrentMemory
// ---------------------------------------------------------------------------

describe("readCurrentMemory", () => {
  it("reads placeholder content after layout initialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "read-memory-"))
    const stateDir = join(root, ".opencode-dream")
    await ensureDreamLayout(stateDir)

    const content = await readCurrentMemory(stateDir)
    expect(content).toContain("Opencode-Dream consolidated memory")
  })

  it("reads custom content written after initialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "read-memory-custom-"))
    const stateDir = join(root, ".opencode-dream")
    await ensureDreamLayout(stateDir)

    const custom = "## My Notes\n\n- Run typecheck before build\n- Use pnpm\n"
    await writeFile(join(stateDir, "memory", "current.md"), custom, "utf8")

    const content = await readCurrentMemory(stateDir)
    expect(content).toBe(custom)
  })
})

// ---------------------------------------------------------------------------
// summarizeDreamState
// ---------------------------------------------------------------------------

describe("summarizeDreamState", () => {
  it("reports correct structure for a freshly initialized layout", async () => {
    const root = await mkdtemp(join(tmpdir(), "summarize-init-"))
    const stateDir = join(root, ".opencode-dream")
    await ensureDreamLayout(stateDir)

    const summary = await summarizeDreamState(stateDir)

    expect(summary.root).toBe(stateDir)
    expect(summary.memoryExists).toBe(true)
    expect(typeof summary.memoryPreview).toBe("string")
    expect((summary.memoryPreview as string).length).toBeGreaterThan(0)
    expect(summary.importedSessionFiles).toBe(0)
    expect(summary.liveSessionFiles).toBe(0)
  })

  it("reports zero counts and memoryExists=false for an empty directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "summarize-empty-"))
    // Do NOT initialize — no subdirectories exist
    const summary = await summarizeDreamState(root)

    expect(summary.importedSessionFiles).toBe(0)
    expect(summary.liveSessionFiles).toBe(0)
    expect(summary.memoryExists).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveDreamConfig — custom options
// ---------------------------------------------------------------------------

describe("resolveDreamConfig custom options", () => {
  it("respects custom projectRelativeStateDir", () => {
    const config = resolveDreamConfig("/project", { projectRelativeStateDir: ".my-dream" })
    expect(config.stateDir).toBe(resolve("/project/.my-dream"))
    expect(config.sessionLiveDir).toContain(".my-dream")
    expect(config.sessionRuntimeDir).toContain(".my-dream")
    expect(config.reflectionDir).toContain(".my-dream")
  })

  it("resolves a custom agentsFile relative to the project directory", () => {
    const config = resolveDreamConfig("/project", { agentsFile: "docs/AGENTS.md" })
    expect(config.agentsFile).toBe(resolve("/project/docs/AGENTS.md"))
  })

  it("resolves a custom memoryFile relative to the project directory", () => {
    const config = resolveDreamConfig("/project", { memoryFile: "custom/memory.md" })
    expect(config.memoryFile).toBe(resolve("/project/custom/memory.md"))
  })

  it("propagates all opencodeMem options when explicitly provided", () => {
    const config = resolveDreamConfig("/project", {
      opencodeMem: {
        enabled: true,
        url: "http://localhost:9090",
        importMode: "replace",
        maxItemLength: 500,
      },
    })
    expect(config.opencodeMem.enabled).toBe(true)
    expect(config.opencodeMem.url).toBe("http://localhost:9090")
    expect(config.opencodeMem.importMode).toBe("replace")
    expect(config.opencodeMem.maxItemLength).toBe(500)
  })

  it("applies opencodeMem defaults when only enabled is provided", () => {
    const config = resolveDreamConfig("/project", { opencodeMem: { enabled: true } })
    expect(config.opencodeMem.url).toBe("http://127.0.0.1:4747")
    expect(config.opencodeMem.importMode).toBe("append")
    expect(config.opencodeMem.maxItemLength).toBe(1000)
  })

  it("defaults logLevel to 'info' when not specified", () => {
    const config = resolveDreamConfig("/project", undefined)
    expect(config.logLevel).toBe("info")
  })

  it("respects custom logLevel", () => {
    const config = resolveDreamConfig("/project", { logLevel: "debug" })
    expect(config.logLevel).toBe("debug")
  })

  it("captureLiveSessions defaults to true", () => {
    const config = resolveDreamConfig("/project", undefined)
    expect(config.captureLiveSessions).toBe(true)
  })

  it("captureLiveSessions can be set to false", () => {
    const config = resolveDreamConfig("/project", { captureLiveSessions: false })
    expect(config.captureLiveSessions).toBe(false)
  })

  it("opencodeMem is disabled by default", () => {
    const config = resolveDreamConfig("/project", undefined)
    expect(config.opencodeMem.enabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// exportDreamManagedSection (agents-md)
// ---------------------------------------------------------------------------

describe("exportDreamManagedSection", () => {
  it("creates AGENTS.md from scratch when the file does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "agents-md-create-"))
    const agentsFile = join(root, "AGENTS.md")

    const result = await exportDreamManagedSection(agentsFile, "- Always run typecheck before build.")

    expect(result.action).toBe("created")
    const content = await readFile(agentsFile, "utf8")
    expect(content).toContain("<!-- OPENCODE-DREAM:BEGIN -->")
    expect(content).toContain("<!-- OPENCODE-DREAM:END -->")
    expect(content).toContain("Always run typecheck before build.")
    expect(content).toContain("# AGENTS.md")
  })

  it("replaces the managed block when both markers already exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "agents-md-replace-"))
    const agentsFile = join(root, "AGENTS.md")

    await writeFile(
      agentsFile,
      [
        "# AGENTS.md",
        "",
        "Some pre-existing guidance.",
        "",
        "<!-- OPENCODE-DREAM:BEGIN -->",
        "## Opencode-Dream consolidated memory",
        "",
        "- old memory item",
        "<!-- OPENCODE-DREAM:END -->",
        "",
        "## Keep this section",
      ].join("\n"),
      "utf8",
    )

    const result = await exportDreamManagedSection(agentsFile, "- new memory content")

    expect(result.action).toBe("replaced")
    const content = await readFile(agentsFile, "utf8")
    expect(content).toContain("new memory content")
    expect(content).not.toContain("old memory item")
    expect(content).toContain("Some pre-existing guidance.")
    expect(content).toContain("## Keep this section")
  })

  it("appends the managed block when file exists but contains no markers", async () => {
    const root = await mkdtemp(join(tmpdir(), "agents-md-append-"))
    const agentsFile = join(root, "AGENTS.md")

    await writeFile(agentsFile, "# AGENTS.md\n\nExisting content without markers.\n", "utf8")

    const result = await exportDreamManagedSection(agentsFile, "- appended memory entry")

    expect(result.action).toBe("appended")
    const content = await readFile(agentsFile, "utf8")
    expect(content).toContain("Existing content without markers.")
    expect(content).toContain("appended memory entry")
    expect(content).toContain("<!-- OPENCODE-DREAM:BEGIN -->")
    expect(content).toContain("<!-- OPENCODE-DREAM:END -->")
  })

  it("created AGENTS.md includes the plugin label in the managed block", async () => {
    const root = await mkdtemp(join(tmpdir(), "agents-md-label-"))
    const agentsFile = join(root, "AGENTS.md")

    await exportDreamManagedSection(agentsFile, "- some memory")

    const content = await readFile(agentsFile, "utf8")
    expect(content).toContain("Opencode-Dream consolidated memory")
    expect(content).toContain("Managed by the Opencode-Dream plugin scaffold")
  })

  it("handles empty memory string by rendering a placeholder", async () => {
    const root = await mkdtemp(join(tmpdir(), "agents-md-empty-"))
    const agentsFile = join(root, "AGENTS.md")

    await exportDreamManagedSection(agentsFile, "")

    const content = await readFile(agentsFile, "utf8")
    expect(content).toContain("no memory content yet")
  })
})
