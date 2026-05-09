import { readFile } from "node:fs/promises"

export type GenericJsonlMessageRole = "user" | "assistant" | "tool" | "system" | "unknown"

export interface GenericJsonlMessage {
  index: number
  role: GenericJsonlMessageRole
  content: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_output?: string
  timestamp?: string
}

export interface GenericJsonlSession {
  agent: string
  started_at: string
  ended_at?: string
  task_description?: string
  project_id?: string
  messages: GenericJsonlMessage[]
  outcome_known?: boolean
  outcome_success?: boolean
  metadata?: Record<string, unknown>
}

export interface GenericJsonlValidationResult {
  totalLines: number
  validLines: number
  invalidLines: number
  sampleErrors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isIsoTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function isMessageRole(value: unknown): value is GenericJsonlMessageRole {
  return value === "user" || value === "assistant" || value === "tool" || value === "system" || value === "unknown"
}

function validateMessageShape(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return "message entry is not a JSON object"
  }
  if (typeof payload.index !== "number") {
    return "message entry missing numeric index"
  }
  if (!isMessageRole(payload.role)) {
    return "message entry has invalid role"
  }
  if (typeof payload.content !== "string") {
    return "message entry missing string content"
  }
  if (payload.tool_name !== undefined && typeof payload.tool_name !== "string") {
    return "message entry tool_name must be a string when present"
  }
  if (payload.tool_input !== undefined && !isRecord(payload.tool_input)) {
    return "message entry tool_input must be an object when present"
  }
  if (payload.tool_output !== undefined && typeof payload.tool_output !== "string") {
    return "message entry tool_output must be a string when present"
  }
  if (payload.timestamp !== undefined && !isIsoTimestamp(payload.timestamp)) {
    return "message entry timestamp must be an ISO 8601 string when present"
  }

  return null
}

function validateSessionShape(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return "line is not a JSON object"
  }
  if (typeof payload.agent !== "string" || !payload.agent) {
    return "missing string field: agent"
  }
  if (typeof payload.started_at !== "string" || !payload.started_at) {
    return "missing string field: started_at"
  }
  if (!isIsoTimestamp(payload.started_at)) {
    return "started_at must be an ISO 8601 string"
  }
  if (payload.ended_at !== undefined && !isIsoTimestamp(payload.ended_at)) {
    return "ended_at must be an ISO 8601 string when present"
  }
  if (payload.task_description !== undefined && typeof payload.task_description !== "string") {
    return "task_description must be a string when present"
  }
  if (payload.project_id !== undefined && typeof payload.project_id !== "string") {
    return "project_id must be a string when present"
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return "missing non-empty array field: messages"
  }
  if (payload.outcome_known !== undefined && typeof payload.outcome_known !== "boolean") {
    return "outcome_known must be a boolean when present"
  }
  if (payload.outcome_success !== undefined && typeof payload.outcome_success !== "boolean") {
    return "outcome_success must be a boolean when present"
  }
  if (payload.metadata !== undefined && !isRecord(payload.metadata)) {
    return "metadata must be an object when present"
  }

  const firstBadMessage = payload.messages
    .map((message) => validateMessageShape(message))
    .find((value) => value !== null)

  if (firstBadMessage) {
    return firstBadMessage
  }

  return null
}

export function parseGenericJsonlSession(payload: unknown): GenericJsonlSession {
  const error = validateSessionShape(payload)
  if (error) {
    throw new Error(error)
  }

  return payload as GenericJsonlSession
}

export async function readGenericJsonlSessionFile(filePath: string): Promise<GenericJsonlSession> {
  const text = await readFile(filePath, "utf8")
  const line = text.split(/\r?\n/).find((value) => value.trim().length > 0)
  if (!line) {
    throw new Error(`No session rows found in ${filePath}`)
  }

  return parseGenericJsonlSession(JSON.parse(line) as unknown)
}

export async function validateGenericJsonlFile(filePath: string): Promise<GenericJsonlValidationResult> {
  const text = await readFile(filePath, "utf8")
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const sampleErrors: string[] = []

  let validLines = 0
  let invalidLines = 0

  lines.forEach((line, index) => {
    try {
      const parsed = JSON.parse(line) as unknown
      const error = validateSessionShape(parsed)
      if (error) {
        invalidLines += 1
        if (sampleErrors.length < 5) {
          sampleErrors.push(`line ${index + 1}: ${error}`)
        }
        return
      }
      validLines += 1
    } catch {
      invalidLines += 1
      if (sampleErrors.length < 5) {
        sampleErrors.push(`line ${index + 1}: invalid JSON`)
      }
    }
  })

  return {
    totalLines: lines.length,
    validLines,
    invalidLines,
    sampleErrors,
  }
}
