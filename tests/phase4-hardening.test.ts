import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { exportDreamManagedSection } from "../src/opendream/agents-md.js"
import { ensureDreamLayout } from "../src/opendream/fs-store.js"
import { readReflectionJsonInput } from "../src/opendream/reflection.js"
import { createOpencodeDreamExportAgentsTool } from "../src/tools/opendream-export-agents.js"

describe("Phase 4 hardening", () => {
  describe("AGENTS broken-marker topology", () => {
    it("replaces a valid managed block even when a stray END marker appears earlier in the file", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase4-agents-topology-"))
      const agentsFile = join(root, "AGENTS.md")

      await writeFile(
        agentsFile,
        [
          "# AGENTS.md",
          "",
          "Stray marker from a damaged manual edit:",
          "<!-- OPENCODE-DREAM:END -->",
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

      const result = await exportDreamManagedSection(agentsFile, "- repaired memory")
      const content = await readFile(agentsFile, "utf8")

      expect(result.action).toBe("replaced")
      expect(content).toContain("- repaired memory")
      expect(content).not.toContain("- old memory item")
      expect(content).toContain("## Keep this section")
    })

    it("reports replace in dry-run preview when a valid block exists after a stray END marker", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase4-agents-preview-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)
      await writeFile(config.memoryFile, "- remembered repair\n", "utf8")
      await writeFile(
        config.agentsFile,
        [
          "# AGENTS.md",
          "",
          "<!-- OPENCODE-DREAM:END -->",
          "",
          "<!-- OPENCODE-DREAM:BEGIN -->",
          "## Opencode-Dream consolidated memory",
          "",
          "- stale memory",
          "<!-- OPENCODE-DREAM:END -->",
        ].join("\n"),
        "utf8",
      )

      const tool = createOpencodeDreamExportAgentsTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      const raw = await tool.execute({ dryRun: true })
      const result = JSON.parse(raw) as { wouldAction: string; previewFragment: string }

      expect(result.wouldAction).toBe("replace")
      expect(result.previewFragment).toContain("remembered repair")
    })
  })

  describe("reflection input ambiguity", () => {
    it("treats empty reflectionJson as provided when paired with reflectionFilePath", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase4-reflection-both-"))
      const reflectionFilePath = join(root, "reflection.json")
      await writeFile(reflectionFilePath, JSON.stringify({ ok: true }), "utf8")

      await expect(
        readReflectionJsonInput({
          reflectionJson: "",
          reflectionFilePath,
        }),
      ).rejects.toThrow(/either reflectionJson or reflectionFilePath/i)
    })

    it("treats empty reflectionJson as direct JSON input instead of missing input", async () => {
      await expect(readReflectionJsonInput({ reflectionJson: "" })).rejects.toThrow(/JSON|Unexpected end/i)
    })
  })
})
