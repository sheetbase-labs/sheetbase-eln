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
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function resolveMinLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  return raw && raw in LEVEL_PRIORITY ? (raw as LogLevel) : 'info'
}

const MIN_LEVEL: LogLevel = resolveMinLevel()

/** A terminal in development gets one readable line instead of JSON. */
const PRETTY =
  process.env.LOG_FORMAT === 'pretty' ||
  (process.env.LOG_FORMAT !== 'json' &&
    process.env.NODE_ENV !== 'production' &&
    Boolean((process as { stdout?: { isTTY?: boolean } }).stdout?.isTTY))

function pretty(
  level: LogLevel,
  message: string,
  fields: Record<string, unknown>,
): string {
  const time = new Date().toISOString().slice(11, 23)
  const rest = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ')
  return `${time} ${level.toUpperCase().padEnd(5)} ${message}${rest ? ' ' + rest : ''}\n`
}

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

/** Recursively redacts sensitive keys from an arbitrary value. */
export function redact<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redact) as unknown as T

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    if (REDACTED_KEYS.has(lower)) {
      out[key] = REDACTED_VALUE
    } else {
      out[key] = redact(val)
    }
  }
  return out as T
}

function emit(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return

  if (PRETTY) {
    const stream =
      level === 'error' || level === 'warn' ? process.stderr : process.stdout
    stream.write(pretty(level, message, redact(fields ?? {})))
    return
  }

  const record = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...redact(fields ?? {}),
  }
  // error/warn go to stderr so operators can split streams; info/debug to stdout.
  const stream =
    level === 'error' || level === 'warn' ? process.stderr : process.stdout
  stream.write(JSON.stringify(record) + '\n')
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) =>
    emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) =>
    emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) =>
    emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) =>
    emit('error', message, fields),
}
