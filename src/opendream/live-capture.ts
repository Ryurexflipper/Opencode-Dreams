import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { Event, Message, ToolPart } from "@opencode-ai/sdk"

import type { DreamResolvedConfig } from "../config.js"
import type { GenericJsonlMessage, GenericJsonlMessageRole, GenericJsonlSession } from "./generic-jsonl.js"

interface CapturePartRecord {
  id: string
  message_id: string
  kind: "text" | "reasoning" | "tool"
  order: number
  text: string
  timestamp?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_output?: string
}

interface CaptureState {
  session_id: string
  agent: string
  project_id?: string
  started_at: string
  ended_at?: string
  task_description?: string
  outcome_known: boolean
  outcome_success?: boolean
  metadata: Record<string, unknown>
  message_roles: Record<string, GenericJsonlMessageRole>
  parts: CapturePartRecord[]
  next_order: number
}

function isTerminalState(state: CaptureState): boolean {
  return Boolean(state.ended_at) || state.outcome_known
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function toIsoTimestamp(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  return new Date(value).toISOString()
}

function runtimePath(config: DreamResolvedConfig, sessionID: string): string {
  return join(config.sessionRuntimeDir, `${sessionID}.json`)
}

function livePath(config: DreamResolvedConfig, sessionID: string): string {
  return join(config.sessionLiveDir, `${sessionID}.jsonl`)
}

function createStateFromSessionCreated(event: Extract<Event, { type: "session.created" }>): CaptureState {
  return {
    session_id: event.properties.info.id,
    agent: "opencode",
    project_id: event.properties.info.projectID,
    started_at: toIsoTimestamp(event.properties.info.time.created) ?? new Date().toISOString(),
    task_description: event.properties.info.title,
    metadata: {
      capture_source: "opencode-dream:event-hook",
      opencode_session_id: event.properties.info.id,
      opencode_session_version: event.properties.info.version,
      opencode_directory: event.properties.info.directory,
    },
    outcome_known: false,
    message_roles: {},
    parts: [],
    next_order: 0,
  }
}

function createFallbackState(sessionID: string): CaptureState {
  return {
    session_id: sessionID,
    agent: "opencode",
    started_at: new Date().toISOString(),
    metadata: {
      capture_source: "opencode-dream:event-hook",
      opencode_session_id: sessionID,
      capture_bootstrap: "fallback",
    },
    outcome_known: false,
    message_roles: {},
    parts: [],
    next_order: 0,
  }
}

async function readState(config: DreamResolvedConfig, sessionID: string): Promise<CaptureState | null> {
  try {
    const content = await readFile(runtimePath(config, sessionID), "utf8")
    return JSON.parse(content) as CaptureState
  } catch {
    return null
  }
}

async function writeState(config: DreamResolvedConfig, state: CaptureState): Promise<void> {
  await mkdir(config.sessionRuntimeDir, { recursive: true })
  await writeFile(runtimePath(config, state.session_id), JSON.stringify(state, null, 2), "utf8")
}

function upsertMessageRole(state: CaptureState, message: Message): void {
  state.message_roles[message.id] = message.role
  if (message.role !== "user") return
  if (typeof message.agent === "string" && message.agent.trim().length > 0) {
    state.agent = message.agent
  }
}

function normalizeToolContent(part: ToolPart): { text: string; tool_output?: string; timestamp?: string } {
  if (part.state.status === "completed") {
    return {
      text: part.state.output || part.state.title || `${part.tool} completed`,
      tool_output: part.state.output || undefined,
      timestamp: toIsoTimestamp(part.state.time.end),
    }
  }
  if (part.state.status === "error") {
    return {
      text: part.state.error,
      tool_output: part.state.error,
      timestamp: toIsoTimestamp(part.state.time.end),
    }
  }
  if (part.state.status === "running") {
    return {
      text: part.state.title || `${part.tool} running`,
      timestamp: toIsoTimestamp(part.state.time.start),
    }
  }

  return {
    text: part.state.raw || `${part.tool} pending`,
  }
}

function normalizePart(event: Extract<Event, { type: "message.part.updated" }>): Omit<CapturePartRecord, "order"> | null {
  const part = event.properties.part
  if (part.type === "text") {
    return {
      id: part.id,
      message_id: part.messageID,
      kind: "text",
      text: part.text,
      timestamp: toIsoTimestamp(part.time?.end ?? part.time?.start),
    }
  }
  if (part.type === "reasoning") {
    return {
      id: part.id,
      message_id: part.messageID,
      kind: "reasoning",
      text: part.text,
      timestamp: toIsoTimestamp(part.time.end ?? part.time.start),
    }
  }
  if (part.type !== "tool") return null

  const tool = normalizeToolContent(part)
  return {
    id: part.id,
    message_id: part.messageID,
    kind: "tool",
    text: tool.text,
    timestamp: tool.timestamp,
    tool_name: part.tool,
    tool_input: isRecord(part.state.input) ? part.state.input : undefined,
    tool_output: tool.tool_output,
  }
}

function upsertPart(state: CaptureState, next: Omit<CapturePartRecord, "order">): void {
  const index = state.parts.findIndex((part) => part.id === next.id)
  if (index < 0) {
    state.parts.push({ ...next, order: state.next_order })
    state.next_order += 1
    return
  }

  state.parts[index] = {
    ...next,
    order: state.parts[index].order,
  }
}

function materializeMessages(state: CaptureState): { messages: GenericJsonlMessage[]; unresolvedParts: number } {
  const ordered = [...state.parts].sort((left, right) => left.order - right.order)
  const messages: GenericJsonlMessage[] = []
  let unresolvedParts = 0

  ordered.forEach((part) => {
    if (part.kind === "tool") {
      messages.push({
        index: messages.length,
        role: "tool",
        content: part.text,
        tool_name: part.tool_name,
        tool_input: part.tool_input,
        tool_output: part.tool_output,
        timestamp: part.timestamp,
      })
      return
    }

    const role = state.message_roles[part.message_id]
    if (role !== "user" && role !== "assistant" && role !== "system") {
      // Preserve the part rather than silently dropping it — mark with role "unknown"
      // so reflection tools see the full conversation and can decide what to do.
      unresolvedParts += 1
      messages.push({
        index: messages.length,
        role: "unknown",
        content: part.kind === "reasoning" ? `[reasoning]\n${part.text}` : part.text,
        timestamp: part.timestamp,
      })
      return
    }

    messages.push({
      index: messages.length,
      role,
      content: part.kind === "reasoning" ? `[reasoning]\n${part.text}` : part.text,
      timestamp: part.timestamp,
    })
  })

  return { messages, unresolvedParts }
}

async function writeLiveSnapshot(config: DreamResolvedConfig, state: CaptureState): Promise<{ filePath: string; messageCount: number; unresolvedParts: number }> {
  const materialized = materializeMessages(state)
  const session: GenericJsonlSession = {
    agent: state.agent,
    project_id: state.project_id,
    started_at: state.started_at,
    ended_at: state.ended_at,
    task_description: state.task_description,
    messages: materialized.messages,
    outcome_known: state.outcome_known,
    outcome_success: state.outcome_success,
    metadata: {
      ...state.metadata,
      unresolved_part_count: materialized.unresolvedParts,
      captured_message_count: materialized.messages.length,
      last_snapshot_at: new Date().toISOString(),
    },
  }

  await mkdir(config.sessionLiveDir, { recursive: true })
  const filePath = livePath(config, state.session_id)
  await writeFile(filePath, `${JSON.stringify(session)}\n`, "utf8")
  return {
    filePath,
    messageCount: materialized.messages.length,
    unresolvedParts: materialized.unresolvedParts,
  }
}

export async function processDreamEventCapture(config: DreamResolvedConfig, event: Event): Promise<{ action: string; sessionID?: string; filePath?: string; messageCount?: number; unresolvedParts?: number } | null> {
  if (!config.captureLiveSessions) return null

  if (event.type === "session.created") {
    const state = createStateFromSessionCreated(event)
    await writeState(config, state)
    return { action: "session-created", sessionID: state.session_id }
  }

  if (event.type === "session.updated") {
    const state = (await readState(config, event.properties.info.id)) ?? createFallbackState(event.properties.info.id)
    if (isTerminalState(state)) {
      return { action: "session-updated-ignored-terminal", sessionID: state.session_id }
    }
    state.project_id = event.properties.info.projectID
    state.task_description = event.properties.info.title
    state.metadata.opencode_session_version = event.properties.info.version
    state.metadata.opencode_directory = event.properties.info.directory
    await writeState(config, state)
    return { action: "session-updated", sessionID: state.session_id }
  }

  if (event.type === "message.updated") {
    const state = (await readState(config, event.properties.info.sessionID)) ?? createFallbackState(event.properties.info.sessionID)
    if (isTerminalState(state)) {
      return { action: "message-updated-ignored-terminal", sessionID: state.session_id }
    }
    upsertMessageRole(state, event.properties.info)
    await writeState(config, state)
    return { action: "message-updated", sessionID: state.session_id }
  }

  if (event.type === "message.part.updated") {
    const state = (await readState(config, event.properties.part.sessionID)) ?? createFallbackState(event.properties.part.sessionID)
    if (isTerminalState(state)) {
      return { action: "message-part-updated-ignored-terminal", sessionID: state.session_id }
    }
    const part = normalizePart(event)
    if (!part) return null
    upsertPart(state, part)
    await writeState(config, state)
    return { action: "message-part-updated", sessionID: state.session_id }
  }

  if (event.type === "session.idle") {
    const state = await readState(config, event.properties.sessionID)
    if (!state) return null
    const snapshot = await writeLiveSnapshot(config, state)
    return { action: "session-idle-snapshot", sessionID: state.session_id, ...snapshot }
  }

  if (event.type === "session.error") {
    if (!event.properties.sessionID) return null
    const state = (await readState(config, event.properties.sessionID)) ?? createFallbackState(event.properties.sessionID)
    state.ended_at = new Date().toISOString()
    state.outcome_known = true
    state.outcome_success = false
    if (event.properties.error) {
      state.metadata.last_error = event.properties.error
    }
    const snapshot = await writeLiveSnapshot(config, state)
    await writeState(config, state)
    return { action: "session-error-snapshot", sessionID: state.session_id, ...snapshot }
  }

  if (event.type === "session.deleted") {
    const state = await readState(config, event.properties.info.id)
    if (!state) return null
    state.ended_at = new Date().toISOString()
    const snapshot = await writeLiveSnapshot(config, state)
    await writeState(config, state)
    return { action: "session-deleted-snapshot", sessionID: state.session_id, ...snapshot }
  }

  return null
}
