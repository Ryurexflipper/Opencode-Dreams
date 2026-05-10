import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { randomUUID } from "node:crypto"

import type { GenericJsonlSession } from "./generic-jsonl.js"

export type DreamConfidence = "low" | "medium" | "high"
export type DreamScope = "task_specific" | "generalizable"
export type DreamValence = "positive" | "negative" | "neutral"
export type DreamSessionCompleteness = "completed" | "interrupted" | "errored" | "partial"
export type DreamComplexity = "trivial" | "simple" | "moderate" | "complex"
export type DreamMemoryKind = "workflow" | "pattern" | "failure_mode" | "preference" | "fact"
export type DreamTaskType = "bug_fix" | "feature_addition" | "refactor" | "exploration" | "debugging" | "test_writing" | "documentation" | "other"

export interface DreamTaskClassification {
  type: DreamTaskType
  domain: string
  complexity: DreamComplexity
}

export interface DreamDecisionPoint {
  moment: string
  choice_made: string
  alternatives_visible?: string | null
  evidence: string
}

export interface DreamApproach {
  strategy_summary: string
  tool_sequence: string[]
  decision_points: DreamDecisionPoint[]
}

export interface DreamBehaviorObservation {
  observation: string
  evidence: string
  confidence: DreamConfidence
  scope: DreamScope
  valence: DreamValence
}

export interface DreamToolUseNote {
  tool: string
  note: string
  evidence: string
}

export interface DreamObservations {
  behaviors_observed: DreamBehaviorObservation[]
  tool_use_notes: DreamToolUseNote[]
  context_observations: string | null
}

export interface DreamOutcome {
  completed: boolean | "unclear"
  user_satisfied: boolean | "unclear"
  evidence: string
}

export interface DreamMemoryCandidate {
  kind: DreamMemoryKind
  content: string
  scope: DreamScope
  evidence: string
  confidence: DreamConfidence
}

export interface DreamReflection {
  id: string
  session_id: string
  created_at: string
  session_completeness: DreamSessionCompleteness
  reflection_confidence: DreamConfidence
  target_task_classification: DreamTaskClassification
  observed_work_classification: DreamTaskClassification
  approach: DreamApproach
  observations: DreamObservations
  outcome: DreamOutcome
  candidates_for_memory: DreamMemoryCandidate[]
}

export const DREAM_REFLECTION_SYSTEM_PROMPT = "You are a meta-cognitive observer for an AI agent."

const DREAM_REFLECTION_TEMPLATE = `# Reflection prompt (Stage 1)

You are a meta-cognitive observer for an AI agent. You will be given a complete record of a single agent session: the task it was asked to do, the actions it took, the outcomes of those actions, and (when available) whether it ultimately succeeded.

## Inputs

### Task description
{task_description}

### Session trace
{session_trace}

### Outcome (if known)
{outcome}

## Output

Return a single JSON object. No commentary, no markdown fences.

{
  "session_completeness": "<completed | interrupted | errored | partial>",
  "reflection_confidence": "<low | medium | high>",
  "target_task_classification": {
    "type": "<bug_fix | feature_addition | refactor | exploration | debugging | test_writing | documentation | other>",
    "domain": "<short description>",
    "complexity": "<trivial | simple | moderate | complex>"
  },
  "observed_work_classification": {
    "type": "<same enum>",
    "domain": "<short description>",
    "complexity": "<trivial | simple | moderate | complex>"
  },
  "approach": {
    "strategy_summary": "<1-2 sentences>",
    "tool_sequence": ["<ordered tools/actions used>"],
    "decision_points": []
  },
  "observations": {
    "behaviors_observed": [],
    "tool_use_notes": [],
    "context_observations": null
  },
  "outcome": {
    "completed": true | false | "unclear",
    "user_satisfied": true | false | "unclear",
    "evidence": "<what tells you this>"
  },
  "candidates_for_memory": []
}

Return ONLY the JSON object.`

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function assertEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`)
  }

  return value as T
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }

  return value
}

function assertOptionalString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string when present`)
  }

  return value
}

function assertOutcomeBoolean(value: unknown, label: string): boolean | "unclear" {
  if (value === true || value === false || value === "unclear") {
    return value
  }

  throw new Error(`${label} must be true, false, or "unclear"`)
}

function renderOutcome(session: GenericJsonlSession): string {
  if (!session.outcome_known) return "unknown"
  if (session.outcome_success === true) return "success"
  if (session.outcome_success === false) return "failure"
  return "unknown"
}

function truncate(value: string, maxMessageChars?: number): string {
  if (!maxMessageChars || value.length <= maxMessageChars) {
    return value
  }

  const elided = value.length - maxMessageChars
  return `${value.slice(0, maxMessageChars)}\n[truncated: ${elided} chars elided]`
}

function renderSessionTrace(session: GenericJsonlSession, maxMessageChars?: number): string {
  return session.messages
    .map((message) => `[${message.index}] ${message.role}: ${truncate(message.content.trim(), maxMessageChars)}`)
    .join("\n\n")
}

function parseTaskClassification(value: unknown, label: string): DreamTaskClassification {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  return {
    type: assertEnum(value.type, ["bug_fix", "feature_addition", "refactor", "exploration", "debugging", "test_writing", "documentation", "other"], `${label}.type`),
    domain: assertString(value.domain, `${label}.domain`),
    complexity: assertEnum(value.complexity, ["trivial", "simple", "moderate", "complex"], `${label}.complexity`),
  }
}

function parseDecisionPoint(value: unknown, label: string): DreamDecisionPoint {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  return {
    moment: assertString(value.moment, `${label}.moment`),
    choice_made: assertString(value.choice_made, `${label}.choice_made`),
    alternatives_visible: assertOptionalString(value.alternatives_visible, `${label}.alternatives_visible`) ?? undefined,
    evidence: assertString(value.evidence, `${label}.evidence`),
  }
}

function parseApproach(value: unknown): DreamApproach {
  if (!isRecord(value)) {
    throw new Error("approach must be an object")
  }
  if (!isStringArray(value.tool_sequence)) {
    throw new Error("approach.tool_sequence must be an array of strings")
  }

  return {
    strategy_summary: assertString(value.strategy_summary, "approach.strategy_summary"),
    tool_sequence: value.tool_sequence,
    decision_points: Array.isArray(value.decision_points)
      ? value.decision_points.map((item, index) => parseDecisionPoint(item, `approach.decision_points[${index}]`))
      : [],
  }
}

function parseBehaviorObservation(value: unknown, label: string): DreamBehaviorObservation {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  return {
    observation: assertString(value.observation, `${label}.observation`),
    evidence: assertString(value.evidence, `${label}.evidence`),
    confidence: assertEnum(value.confidence, ["low", "medium", "high"], `${label}.confidence`),
    scope: assertEnum(value.scope, ["task_specific", "generalizable"], `${label}.scope`),
    valence: assertEnum(value.valence ?? "neutral", ["positive", "negative", "neutral"], `${label}.valence`),
  }
}

function parseToolUseNote(value: unknown, label: string): DreamToolUseNote {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  return {
    tool: assertString(value.tool, `${label}.tool`),
    note: assertString(value.note, `${label}.note`),
    evidence: assertString(value.evidence, `${label}.evidence`),
  }
}

function parseObservations(value: unknown): DreamObservations {
  if (!isRecord(value)) {
    throw new Error("observations must be an object")
  }

  return {
    behaviors_observed: Array.isArray(value.behaviors_observed)
      ? value.behaviors_observed.map((item, index) => parseBehaviorObservation(item, `observations.behaviors_observed[${index}]`))
      : [],
    tool_use_notes: Array.isArray(value.tool_use_notes)
      ? value.tool_use_notes.map((item, index) => parseToolUseNote(item, `observations.tool_use_notes[${index}]`))
      : [],
    context_observations: assertOptionalString(value.context_observations, "observations.context_observations"),
  }
}

function parseOutcome(value: unknown): DreamOutcome {
  if (!isRecord(value)) {
    throw new Error("outcome must be an object")
  }

  return {
    completed: assertOutcomeBoolean(value.completed, "outcome.completed"),
    user_satisfied: assertOutcomeBoolean(value.user_satisfied, "outcome.user_satisfied"),
    evidence: assertString(value.evidence, "outcome.evidence"),
  }
}

function parseMemoryCandidate(value: unknown, label: string): DreamMemoryCandidate {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`)
  }

  return {
    kind: assertEnum(value.kind, ["workflow", "pattern", "failure_mode", "preference", "fact"], `${label}.kind`),
    content: assertString(value.content, `${label}.content`),
    scope: assertEnum(value.scope, ["task_specific", "generalizable"], `${label}.scope`),
    evidence: assertString(value.evidence, `${label}.evidence`),
    confidence: assertEnum(value.confidence, ["low", "medium", "high"], `${label}.confidence`),
  }
}

export function resolveDreamSessionID(session: GenericJsonlSession, sourcePath?: string): string {
  const metadataSessionID = isRecord(session.metadata) && typeof session.metadata.opendream_session_id === "string"
    ? session.metadata.opendream_session_id
    : isRecord(session.metadata) && typeof session.metadata.opencode_session_id === "string"
      ? session.metadata.opencode_session_id
      : null

  if (metadataSessionID) return metadataSessionID
  if (sourcePath) return basename(sourcePath).replace(/\.[^.]+$/, "")
  return randomUUID()
}

export function renderDreamReflectionPrompt(
  session: GenericJsonlSession,
  options?: { maxMessageChars?: number },
): { system: string; user: string } {
  return {
    system: DREAM_REFLECTION_SYSTEM_PROMPT,
    user: DREAM_REFLECTION_TEMPLATE
      .replace("{task_description}", session.task_description ?? "(unspecified)")
      .replace("{session_trace}", renderSessionTrace(session, options?.maxMessageChars))
      .replace("{outcome}", renderOutcome(session)),
  }
}

export function reflectionFromJson(data: unknown, sessionID: string): DreamReflection {
  if (!isRecord(data)) {
    throw new Error("reflection payload must be an object")
  }

  return {
    id: typeof data.id === "string" && data.id.length > 0 ? data.id : randomUUID(),
    session_id: sessionID,
    created_at: typeof data.created_at === "string" && data.created_at.length > 0 ? data.created_at : new Date().toISOString(),
    session_completeness: assertEnum(data.session_completeness, ["completed", "interrupted", "errored", "partial"], "session_completeness"),
    reflection_confidence: assertEnum(data.reflection_confidence, ["low", "medium", "high"], "reflection_confidence"),
    target_task_classification: parseTaskClassification(data.target_task_classification, "target_task_classification"),
    observed_work_classification: parseTaskClassification(data.observed_work_classification, "observed_work_classification"),
    approach: parseApproach(data.approach),
    observations: parseObservations(data.observations),
    outcome: parseOutcome(data.outcome),
    candidates_for_memory: Array.isArray(data.candidates_for_memory)
      ? data.candidates_for_memory.map((item, index) => parseMemoryCandidate(item, `candidates_for_memory[${index}]`))
      : [],
  }
}

export async function readReflectionJsonInput(input: { reflectionJson?: string; reflectionFilePath?: string }): Promise<unknown> {
  const { reflectionJson, reflectionFilePath } = input
  const hasReflectionJson = reflectionJson !== undefined
  const hasReflectionFilePath = reflectionFilePath !== undefined

  if (hasReflectionJson && hasReflectionFilePath) {
    throw new Error("Provide either reflectionJson or reflectionFilePath, not both")
  }
  if (!hasReflectionJson && !hasReflectionFilePath) {
    throw new Error("Provide reflectionJson or reflectionFilePath")
  }
  if (hasReflectionJson) {
    return JSON.parse(reflectionJson) as unknown
  }

  return JSON.parse(await readFile(reflectionFilePath as string, "utf8")) as unknown
}
