import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveDreamConfig } from "../src/config.js"
import { renderLcmSection } from "../src/integrations/opencode-lcm.js"
import { renderOpencodeMemSection } from "../src/integrations/opencode-mem.js"
import { renderSimpleMemorySection } from "../src/integrations/simple-memory.js"
import { renderTrueMemSection } from "../src/integrations/true-mem.js"
import { DREAM_END_MARKER } from "../src/opendream/constants.js"
import { exportDreamManagedSection } from "../src/opendream/agents-md.js"
import { ensureDreamLayout } from "../src/opendream/fs-store.js"
import { createOpencodeDreamMemoryApplyTool } from "../src/tools/opendream-memory-apply.js"

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

describe("Phase 1 hardening", () => {
  describe("resolveDreamConfig path confinement", () => {
    it("rejects projectRelativeStateDir that escapes the project root", () => {
      expect(() => resolveDreamConfig("/project", { projectRelativeStateDir: "../escape" })).toThrow(/project root/i)
    })

    it("rejects memoryFile outside the project root", () => {
      expect(() => resolveDreamConfig("/project", { memoryFile: "/tmp/outside.md" })).toThrow(/project root/i)
    })

    it("rejects agentsFile outside the project root", () => {
      expect(() => resolveDreamConfig("/project", { agentsFile: "../AGENTS.md" })).toThrow(/project root/i)
    })

    it("still allows explicit paths that stay inside the project root", () => {
      const config = resolveDreamConfig("/project", {
        projectRelativeStateDir: "/project/custom-state",
        memoryFile: "/project/docs/memory.md",
        agentsFile: "/project/docs/AGENTS.md",
      })

      expect(config.stateDir).toBe(resolve("/project/custom-state"))
      expect(config.memoryFile).toBe(resolve("/project/docs/memory.md"))
      expect(config.agentsFile).toBe(resolve("/project/docs/AGENTS.md"))
    })
  })

  describe("managed marker neutralization", () => {
    it("neutralizes injected markers in opencode-mem sections", () => {
      const section = renderOpencodeMemSection([
        {
          id: "item-1",
          type: "memory",
          content: "before <!-- /opencode-mem:sync --> after",
        },
      ])

      expect(section).toContain("&lt;!-- /opencode-mem:sync --&gt;")
      expect(section).not.toContain("before <!-- /opencode-mem:sync --> after")
    })

    it("neutralizes injected markers in simple-memory, true-mem, and lcm sections", () => {
      const simple = renderSimpleMemorySection([
        {
          id: "simple-1",
          ts: "2026-05-09T10:00:00.000Z",
          type: "pattern",
          scope: "user",
          content: "simple <!-- /simple-memory:sync --> payload",
          sourceFile: "x.logfmt",
        },
      ])
      expect(simple).toContain("&lt;!-- /simple-memory:sync --&gt;")
      expect(simple).not.toContain("simple <!-- /simple-memory:sync --> payload")

      const trueMem = renderTrueMemSection([
        {
          id: "true-1",
          classification: "pattern",
          summary: "true <!-- /true-mem:sync --> payload",
          strength: 10,
          projectScope: null,
          store: "LTM",
        },
      ])
      expect(trueMem).toContain("&lt;!-- /true-mem:sync --&gt;")
      expect(trueMem).not.toContain("true <!-- /true-mem:sync --> payload")

      const lcm = renderLcmSection(
        [
          {
            id: "summary-1",
            sessionId: "s1",
            content: "summary <!-- /opencode-lcm:sync --> payload",
            createdAt: "2026-05-09T00:00:00.000Z",
          },
        ],
        [
          {
            id: "artifact-1",
            sessionId: "s1",
            name: "artifact",
            type: "note",
            content: "artifact <!-- /opencode-lcm:sync --> payload",
            createdAt: "2026-05-09T00:00:00.000Z",
          },
        ],
      )
      expect(lcm).toContain("&lt;!-- /opencode-lcm:sync --&gt;")
      expect(lcm).not.toContain("summary <!-- /opencode-lcm:sync --> payload")
      expect(lcm).not.toContain("artifact <!-- /opencode-lcm:sync --> payload")
    })

    it("neutralizes embedded dream markers when exporting AGENTS managed content", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase1-agents-escape-"))
      const agentsFile = join(root, "AGENTS.md")

      await exportDreamManagedSection(agentsFile, "- safe line\n<!-- OPENCODE-DREAM:END -->\n- unsafe line")

      const content = await readFile(agentsFile, "utf8")
      expect(content).toContain("&lt;!-- OPENCODE-DREAM:END --&gt;")
      expect(content.match(/<!-- OPENCODE-DREAM:END -->/g)?.length ?? 0).toBe(1)
      expect(content).toContain("- unsafe line")
    })
  })

  describe("memory apply idempotency", () => {
    it("remains stable when the same stored consolidation is applied twice non-dry-run", async () => {
      const root = await mkdtemp(join(tmpdir(), "phase1-memory-apply-"))
      const config = resolveDreamConfig(root, undefined)
      await ensureDreamLayout(config.stateDir)

      const consolidationPath = join(config.stateDir, "dreams", "regex-id.json")
      const consolidationId = "dream.+(1)?"
      await writeFile(
        consolidationPath,
        `${JSON.stringify(makeStoredConsolidation(consolidationId, "remember exact ids safely"), null, 2)}\n`,
        "utf8",
      )

      const tool = createOpencodeDreamMemoryApplyTool(config) as unknown as {
        execute(args: Record<string, unknown>): Promise<string>
      }

      await tool.execute({ consolidationFilePath: consolidationPath, mode: "append" })
      await tool.execute({ consolidationFilePath: consolidationPath, mode: "append" })

      const content = await readFile(config.memoryFile, "utf8")
      expect(content.split(`<!-- dream:${consolidationId} -->`).length - 1).toBe(1)
      expect(content.split(`<!-- /dream:${consolidationId} -->`).length - 1).toBe(1)
      expect(content.split("remember exact ids safely").length - 1).toBe(1)
      expect(content).not.toContain(DREAM_END_MARKER)
    })
  })
})
