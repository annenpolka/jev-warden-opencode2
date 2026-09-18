/**
 * Live Jev transport (adapter side).
 *
 * Responsibilities kept in this file:
 * - read the API key at call time from the OS credential store (never store,
 *   log, or return it);
 * - send exactly one narrow state + question set per request;
 * - validate every answer field instead of normalising silently;
 * - enforce a request budget and a deadline;
 * - keep failures distinct: unavailable vs invalid_response vs budget_exhausted.
 *
 * It never turns a probability into an authorization decision. The endpoint is
 * fixed configuration: an authentication failure never rewrites it.
 */
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"

export type JevQuestionType = "noul" | "choice" | "score"

export interface JevQuestion {
  readonly type: JevQuestionType
  readonly instructions: string
  readonly criteria?: Readonly<Record<string, string>>
  readonly options?: readonly string[]
  readonly range?: { readonly min: number; readonly max: number }
}

export interface JevState {
  readonly [key: string]: unknown
}

export interface NoulAnswer {
  readonly type: "noul"
  readonly noul: number
}

export interface ChoiceAnswer {
  readonly type: "choice"
  readonly choice: string
  readonly probabilities: Readonly<Record<string, number>>
  readonly confidence?: number
}

export interface ScoreAnswer {
  readonly type: "score"
  readonly score: number
  readonly probabilities?: Readonly<Record<string, number>>
  readonly confidence?: number
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer

export type JevCallStatus = "completed" | "unavailable" | "invalid_response" | "budget_exhausted"

export interface JevCallResult {
  readonly status: JevCallStatus
  readonly model?: string
  readonly answers?: Readonly<Record<string, JevAnswer>>
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
  readonly error?: string
  readonly requestDigest: string
  readonly stateDigest: string
  readonly questionsDigest: string
  readonly startedAt: number
  readonly finishedAt: number
}

export interface KeyReadResult {
  readonly key: string | null
  readonly error?: string
}

/** Reads the key from the OS credential store. Returns null when absent. */
export type KeyReader = () => Promise<KeyReadResult>

export interface LiveJevOptions {
  readonly endpoint: string
  readonly model: string
  readonly timeoutMs: number
  readonly maxRequests: number
  readonly maxStateBytes: number
  readonly keyReader: KeyReader
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
}

export interface LiveJev {
  evaluate(state: JevState, questions: Readonly<Record<string, JevQuestion>>): Promise<JevCallResult>
  readonly requestsUsed: number
  readonly requestsRemaining: number
}

export const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
export const DEFAULT_MODEL = "jev-latest"

/** macOS Keychain reader for the `typesafe-api` generic password. */
export function macOsKeychainReader(): KeyReader {
  return async () => {
    if (process.platform !== "darwin") {
      return { key: null, error: `key_store_unsupported_on:${process.platform}` }
    }
    return new Promise((resolve) => {
      execFile(
        "security",
        ["find-generic-password", "-s", "typesafe-api", "-w"],
        { timeout: 10_000, maxBuffer: 64 * 1024 },
        (error, stdout) => {
          if (error !== null) {
            // The store error is surfaced by category only; no key material is read here.
            resolve({ key: null, error: "key_store_lookup_failed" })
            return
          }
          const key = stdout.trim()
          resolve(key.length === 0 ? { key: null, error: "key_empty" } : { key })
        },
      )
    })
  }
}

export function createLiveJev(options: LiveJevOptions): LiveJev {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => Date.now())
  let requestsUsed = 0

  const evaluate = async (
    state: JevState,
    questions: Readonly<Record<string, JevQuestion>>,
  ): Promise<JevCallResult> => {
    const startedAt = now()
    const stateDigest = digestJson(state)
    const questionsDigest = digestJson(questions)
    const requestDigest = createHash("sha256")
      .update(`${stateDigest}\n${questionsDigest}\n${options.model}`)
      .digest("hex")

    const stateBytes = Buffer.byteLength(JSON.stringify(state), "utf8")
    if (stateBytes > options.maxStateBytes) {
      return {
        status: "invalid_response",
        error: "state_too_large",
        requestDigest,
        stateDigest,
        questionsDigest,
        startedAt,
        finishedAt: now(),
      }
    }
    if (Object.keys(questions).length === 0) {
      return {
        status: "invalid_response",
        error: "no_questions",
        requestDigest,
        stateDigest,
        questionsDigest,
        startedAt,
        finishedAt: now(),
      }
    }
    if (requestsUsed >= options.maxRequests) {
      return {
        status: "budget_exhausted",
        error: "request_budget_exhausted",
        requestDigest,
        stateDigest,
        questionsDigest,
        startedAt,
        finishedAt: now(),
      }
    }

    const keyResult = await options.keyReader()
    if (keyResult.key === null) {
      return {
        status: "unavailable",
        error: keyResult.error ?? "key_missing",
        requestDigest,
        stateDigest,
        questionsDigest,
        startedAt,
        finishedAt: now(),
      }
    }

    requestsUsed += 1
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
    try {
      const response = await fetchImpl(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${keyResult.key}`,
        },
        body: JSON.stringify({ state, questions, model: options.model }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const body = await response.text().catch(() => "")
        return {
          status: "unavailable",
          error: `http_${response.status}:${redact(body).slice(0, 200)}`,
          requestDigest,
          stateDigest,
          questionsDigest,
          startedAt,
          finishedAt: now(),
        }
      }
      const payload: unknown = await response.json()
      const parsed = parseResponse(payload, questions, requestDigest, stateDigest, questionsDigest, startedAt, now())
      return parsed
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: "unavailable",
        error: `transport_error:${redact(message).slice(0, 200)}`,
        requestDigest,
        stateDigest,
        questionsDigest,
        startedAt,
        finishedAt: now(),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    evaluate,
    get requestsUsed() {
      return requestsUsed
    },
    get requestsRemaining() {
      return Math.max(0, options.maxRequests - requestsUsed)
    },
  }
}

export function parseResponse(
  payload: unknown,
  questions: Readonly<Record<string, JevQuestion>>,
  requestDigest: string,
  stateDigest: string,
  questionsDigest: string,
  startedAt: number,
  finishedAt: number,
): JevCallResult {
  if (payload === null || typeof payload !== "object") {
    return invalid("response_not_object", requestDigest, stateDigest, questionsDigest, startedAt, finishedAt)
  }
  const record = payload as Record<string, unknown>
  const model = typeof record.model === "string" ? record.model : undefined
  const answersRaw = record.answers
  if (answersRaw === null || typeof answersRaw !== "object") {
    return invalid("answers_missing", requestDigest, stateDigest, questionsDigest, startedAt, finishedAt, model)
  }
  const usage = readUsage(record.usage)
  const answers: Record<string, JevAnswer> = {}
  for (const [name, question] of Object.entries(questions)) {
    const raw = (answersRaw as Record<string, unknown>)[name]
    if (raw === undefined) {
      return invalid(`answer_missing:${name}`, requestDigest, stateDigest, questionsDigest, startedAt, finishedAt, model)
    }
    const parsed = parseAnswer(raw, question)
    if (parsed === null) {
      return invalid(`answer_invalid:${name}`, requestDigest, stateDigest, questionsDigest, startedAt, finishedAt, model)
    }
    answers[name] = parsed
  }
  return {
    status: "completed",
    ...(model === undefined ? {} : { model }),
    answers,
    ...(usage === undefined ? {} : { usage }),
    requestDigest,
    stateDigest,
    questionsDigest,
    startedAt,
    finishedAt,
  }
}

function parseAnswer(raw: unknown, question: JevQuestion): JevAnswer | null {
  if (raw === null || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const type = record.type
  if (type !== question.type) return null
  if (type === "noul") {
    const noul = record.noul
    if (typeof noul !== "number" || !Number.isFinite(noul) || noul < 0 || noul > 1) return null
    return { type: "noul", noul }
  }
  if (type === "choice") {
    const choice = record.choice
    const probabilities = record.probabilities
    if (typeof choice !== "string") return null
    if (probabilities === null || typeof probabilities !== "object") return null
    const entries = Object.entries(probabilities as Record<string, unknown>)
    if (entries.length === 0) return null
    let sum = 0
    for (const [, value] of entries) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
      sum += value
    }
    if (Math.abs(sum - 1) > 0.02) return null
    const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
      ? record.confidence
      : undefined
    return {
      type: "choice",
      choice,
      probabilities: probabilities as Record<string, number>,
      ...(confidence === undefined ? {} : { confidence }),
    }
  }
  const score = record.score
  if (typeof score !== "number" || !Number.isFinite(score)) return null
  return { type: "score", score }
}

function invalid(
  error: string,
  requestDigest: string,
  stateDigest: string,
  questionsDigest: string,
  startedAt: number,
  finishedAt: number,
  model?: string,
): JevCallResult {
  return {
    status: "invalid_response",
    ...(model === undefined ? {} : { model }),
    error,
    requestDigest,
    stateDigest,
    questionsDigest,
    startedAt,
    finishedAt,
  }
}

function readUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (value === null || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const inputTokens = typeof record.input_tokens === "number" ? record.input_tokens : undefined
  const outputTokens = typeof record.output_tokens === "number" ? record.output_tokens : undefined
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return { ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }) }
}

function digestJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** Removes anything that looks like key material from error text. */
export function redact(value: string): string {
  return value.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
}
