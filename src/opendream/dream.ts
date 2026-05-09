import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { randomUUID } from "node:crypto"

import type { DreamReflection, DreamMemoryCandidate, DreamConfidence } from "./reflection.js"

export type DreamThemeKind = "workflow" | "pattern" | "failure_mode" | "preference" | "fact"

export interface DreamTheme {
  kind: DreamThemeKind
  title: string
  summary: string
  evidence_count: number
  confidence: DreamConfidence
  scope: "task_specific" | "generalizable"
  source_sessions: string[]
}

export interface DreamMemoryEntry {
  kind: DreamThemeKind
  content: string
  confidence: DreamConfidence
  scope: "task_specific" | "generalizable"
  source_sessions: string[]
}

export interface DreamConsolidation {
  id: string
  created_at: string
  session_count: number
  reflection_ids: string[]
  themes: DreamTheme[]
  memory_entries: DreamMemoryEntry[]
  synthesis_notes: string | null
}

export const DREAM_CONSOLIDATION_SYSTEM_PROMPT =
  "You are a meta-cognitive synthesis engine for an AI agent. Your task is to extract durable, generalizable knowledge from a set of session reflections."

export function renderDreamConsolidationPrompt(
  reflections: DreamReflection[],
  existingMemory: string,
): { system: string; user: string } {
  const candidatesText = reflections
    .flatMap((r) =>
      r.candidates_for_memory.map(
        (c: DreamMemoryCandidate) =>
          `[session: ${r.session_id}] [kind: ${c.kind}] [confidence: ${c.confidence}] [scope: ${c.scope}]\n${c.content}\nEvidence: ${c.evidence}`,
      ),
    )
    .join("\n\n---\n\n")

  const summaryText = reflections
    .map(
      (r) =>
        `Session: ${r.session_id}\n  Task: ${r.target_task_classification.domain} (${r.target_task_classification.complexity})\n  Outcome: completed=${r.outcome.completed}, satisfied=${r.outcome.user_satisfied}\n  Strategy: ${r.approach.strategy_summary}`,
    )
    .join("\n")

  const user = `# Dream Consolidation Prompt (Stage 2)

You are synthesizing knowledge from ${reflections.length} session reflection(s) into durable memory.

## Existing Memory (current.md)
${existingMemory.trim() || "(empty)"}

## Session Summaries
${summaryText}

## Memory Candidates (${reflections.reduce((acc, r) => acc + r.candidates_for_memory.length, 0)} total)
${candidatesText || "(no candidates)"}

## Task

Analyze the candidates and session summaries. Produce a JSON consolidation object. Rules:
- Merge similar candidates; prefer high-confidence, generalizable ones
- Synthesize patterns visible across multiple sessions
- Only include entries where confidence >= medium unless it's a unique high-signal failure
- Preserve task_specific entries only if they represent clear future hazards

Return a single JSON object with NO markdown fences:

{
  "themes": [
    {
      "kind": "<workflow | pattern | failure_mode | preference | fact>",
      "title": "<short title>",
      "summary": "<1-2 sentence summary>",
      "evidence_count": <number of supporting candidates>,
      "confidence": "<low | medium | high>",
      "scope": "<task_specific | generalizable>",
      "source_sessions": ["<session_id>", ...]
    }
  ],
  "memory_entries": [
    {
      "kind": "<workflow | pattern | failure_mode | preference | fact>",
      "content": "<the actual memory content to store>",
      "confidence": "<low | medium | high>",
      "scope": "<task_specific | generalizable>",
      "source_sessions": ["<session_id>", ...]
    }
  ],
  "synthesis_notes": "<optional notes on what was merged, excluded, or needs follow-up, or null>"
}

Return ONLY the JSON object.`

  return { system: DREAM_CONSOLIDATION_SYSTEM_PROMPT, user }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function assertEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`)
  }
  return value as T
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number`)
  }
  return value
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value as string[]
}

function assertOptionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw new Error(`${label} must be a string when present`)
  return value
}

export function consolidationFromJson(data: unknown, reflections: DreamReflection[]): DreamConsolidation {
  if (!isRecord(data)) {
    throw new Error("consolidation payload must be an object")
  }

  const themes: DreamTheme[] = Array.isArray(data.themes)
    ? data.themes.map((item, i) => {
        if (!isRecord(item)) throw new Error(`themes[${i}] must be an object`)
        return {
          kind: assertEnum(item.kind, ["workflow", "pattern", "failure_mode", "preference", "fact"], `themes[${i}].kind`),
          title: assertString(item.title, `themes[${i}].title`),
          summary: assertString(item.summary, `themes[${i}].summary`),
          evidence_count: assertNumber(item.evidence_count, `themes[${i}].evidence_count`),
          confidence: assertEnum(item.confidence, ["low", "medium", "high"], `themes[${i}].confidence`),
          scope: assertEnum(item.scope, ["task_specific", "generalizable"], `themes[${i}].scope`),
          source_sessions: assertStringArray(item.source_sessions, `themes[${i}].source_sessions`),
        }
      })
    : []

  const memory_entries: DreamMemoryEntry[] = Array.isArray(data.memory_entries)
    ? data.memory_entries.map((item, i) => {
        if (!isRecord(item)) throw new Error(`memory_entries[${i}] must be an object`)
        return {
          kind: assertEnum(item.kind, ["workflow", "pattern", "failure_mode", "preference", "fact"], `memory_entries[${i}].kind`),
          content: assertString(item.content, `memory_entries[${i}].content`),
          confidence: assertEnum(item.confidence, ["low", "medium", "high"], `memory_entries[${i}].confidence`),
          scope: assertEnum(item.scope, ["task_specific", "generalizable"], `memory_entries[${i}].scope`),
          source_sessions: assertStringArray(item.source_sessions, `memory_entries[${i}].source_sessions`),
        }
      })
    : []

  return {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    session_count: reflections.length,
    reflection_ids: reflections.map((r) => r.id),
    themes,
    memory_entries,
    synthesis_notes: assertOptionalString(data.synthesis_notes, "synthesis_notes"),
  }
}

export async function readReflectionFile(filePath: string): Promise<DreamReflection> {
  const text = await readFile(filePath, "utf8")
  const parsed = JSON.parse(text) as unknown
  if (!isRecord(parsed)) {
    throw new Error(`Reflection file ${basename(filePath)} is not a valid object`)
  }
  // Light-cast: we trust our own stored files, just return
  return parsed as unknown as DreamReflection
}
