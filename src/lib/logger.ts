/**
 * API-006: structured server logging. Emits one JSON object per line to
 * stdout so a log aggregator can parse them. Severity follows syslog
 * conventions (docs/operations/observability.md):
 *
 *   debug  — local dev only; never on in production.
 *   info   — request lifecycle, successful operations.
 *   warn   — recoverable problems (rate limit hit, retry, bad client input).
 *   error  — failures a developer must investigate.
 *
 * Secrets, tokens, cookies, formula contents and sensitive scientific
 * payloads are stripped by redact() before any field is logged. When in
 * doubt, log less, not more.
 */
import { initLogger, log, toLoggerConfig } from 'evlog'
import { z } from 'zod'

import evlogConfig from '../../evlog.config'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function resolveMinLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase()

  return LEVELS.find((level) => level === raw) ?? 'info'
}

const MIN_LEVEL: LogLevel = resolveMinLevel()

// evlog.config.ts is the one place that decides level, format and sampling.
initLogger(toLoggerConfig(evlogConfig))

/** Keys whose values are never logged verbatim. */
const REDACTED_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'secret',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'pgrst_jwt_secret',
  'better_auth_secret',
  'github_client_secret',
  'postgres_password',
])

const REDACTED_VALUE = '[redacted]'

/** One log line's fields, as each caller measured them. */
const logFieldsSchema = z.record(z.string(), z.unknown())

export type LogFields = z.infer<typeof logFieldsSchema>

/**
 * The value kinds a log line holds as-is. Objects and arrays are walked
 * instead, so a sensitive key inside one is still replaced.
 */
const scalarValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.bigint(),
  z.symbol(),
  z.function(),
  z.undefined(),
  z.null(),
])

function isScalar<Value>(value: Value): boolean {
  return scalarValue.safeParse(value).success
}

/** Narrows a value to the object or array the redactor walks. */
function isWalkable<Value>(value: Value): value is Value & object {
  return !isScalar(value)
}

/** Rebuilds an object or array with the values under sensitive keys replaced. */
function rebuild<Value extends object>(value: Value): object {
  if (Array.isArray(value)) return value.map((entry) => redact(entry))

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED_VALUE : redact(entry),
    ]),
  )
}

/** Recursively redacts sensitive keys from an arbitrary value. */
export function redact<T>(value: T): T {
  if (!isWalkable(value)) return value

  // SAFETY: rebuild keeps every key and array position the value has and only
  // replaces the values held under sensitive keys, so the result keeps T.
  return rebuild(value) as T
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return
  // evlog does not redact simple logs on its own, so this stays ours.
  log[level]({ message, ...redact(fields ?? {}) })
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) =>
    emit('error', message, fields),
}
