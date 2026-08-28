/**
 * AUTO-02 — transform statement boundary.
 *
 * A Pipeline transform is exactly one deterministic SELECT (optionally with a
 * leading WITH) over the materialized input temp tables. The static checks
 * here are defense-in-depth and better errors; the actual security boundary
 * is the low-privilege `pipeline_worker` session role (zero table grants,
 * temp-schema-only search_path, fixed statement_timeout) that executes the
 * statement server-side. A statement that trips any check is refused
 * outright — fail closed.
 */

export const MAX_RESULT_ROWS = 100_000
export const MAX_EXECUTION_SECONDS = 60

const BLOCKED_KEYWORDS = [
  'COPY',
  'CREATE',
  'DROP',
  'ALTER',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'DO',
  'CALL',
  'EXECUTE',
  'IMPORT',
  'SECURITY',
  'INTO',
  'DECLARE',
  'PREPARE',
  'NOTIFY',
  'LISTEN',
  'UNLISTEN',
  'VACUUM',
  'ANALYZE',
  'REINDEX',
  'CLUSTER',
  'LOCK',
  'COMMENT',
  'REFRESH',
  'SET',
  'RESET',
  'SHOW',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'FETCH',
  'MOVE',
]

const BLOCKED_FUNCTION_PREFIXES = [
  'pg_',
  'lo_',
  'current_setting',
  'set_config',
  'to_reg',
  'pg_read',
  'pg_write',
]

const SCHEMA_QUALIFIED_RE =
  /(^|[^a-zA-Z0-9_"])(api|internal|pg_catalog|information_schema|public)\s*\./i

export type StatementCheck = { ok: true } | { ok: false; reason: string }

/**
 * Validate a transform statement. Empty input is invalid; the caller
 * (config validator) enforces length bounds. Returns a normalized statement
 * with a trailing semicolon removed when present.
 */
export function checkTransformStatement(statement: string): StatementCheck {
  const text = statement.trim()
  if (text.length === 0) return { ok: false, reason: 'statement is empty' }

  // A single statement only: strip one trailing semicolon, then reject any
  // other semicolon.
  const normalized = text.replace(/;+$/, '')
  if (normalized.includes(';')) {
    return { ok: false, reason: 'only a single statement is allowed' }
  }

  const upper = normalized.toUpperCase()
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { ok: false, reason: 'transform must be a single SELECT statement' }
  }

  if (normalized.includes('--')) {
    return { ok: false, reason: 'comments are not allowed' }
  }
  if (normalized.includes('/*')) {
    return { ok: false, reason: 'comments are not allowed' }
  }
  if (normalized.includes('$')) {
    return { ok: false, reason: 'dollar-quoting is not allowed' }
  }
  if (normalized.includes('\\')) {
    return { ok: false, reason: 'backslash escapes are not allowed' }
  }

  for (const keyword of BLOCKED_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(upper)) {
      return {
        ok: false,
        reason: `unsupported SQL keyword: ${keyword.toLowerCase()}`,
      }
    }
  }

  for (const prefix of BLOCKED_FUNCTION_PREFIXES) {
    if (new RegExp(`\\b${prefix}`, 'i').test(normalized)) {
      return {
        ok: false,
        reason: `unsupported function or identifier: ${prefix}`,
      }
    }
  }

  if (SCHEMA_QUALIFIED_RE.test(normalized)) {
    return { ok: false, reason: 'schema-qualified names are not allowed' }
  }

  return { ok: true }
}

/**
 * Wrap a validated statement so the result set is bounded server-side:
 * `SELECT * FROM (<statement>) AS "_sb_result" LIMIT <cap + 1>`. The extra
 * row lets the executor detect a limit breach.
 */
export function wrapTransformStatement(statement: string): string {
  return `SELECT * FROM (${statement}) AS "_sb_result" LIMIT ${MAX_RESULT_ROWS + 1}`
}

/**
 * Substitute `{{name}}` placeholders with typed SQL literals. The statement
 * author references only the declared parameter names; values are validated
 * and quoted so a placeholder can never inject a second statement. A
 * placeholder naming an undeclared parameter is an authoring error, not an
 * injection surface.
 */
export function substituteParameters(
  statement: string,
  parameters: Record<string, unknown>,
  parameterTypes: Record<string, string>,
): { ok: true; statement: string } | { ok: false; reason: string } {
  const placeholderRe = /\{\{([a-z][a-z0-9_]{0,47})\}\}/g
  const used = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = placeholderRe.exec(statement)) !== null) {
    used.add(match[1])
  }
  // Resolve every placeholder to a literal first; any failure aborts the
  // whole substitution so a partially-rewritten statement never runs.
  const literals = new Map<string, string>()
  for (const name of used) {
    const literal = literalForParameter(name, parameters, parameterTypes)
    if (typeof literal !== 'string') {
      return { ok: false, reason: literal.reason }
    }
    literals.set(name, literal)
  }
  const result = statement.replace(placeholderRe, (_, name: string) => {
    return literals.get(name) ?? 'NULL'
  })
  return { ok: true, statement: result }
}

function literalForParameter(
  name: string,
  parameters: Record<string, unknown>,
  parameterTypes: Record<string, string>,
): string | { reason: string } {
  const type = parameterTypes[name]
  if (!type) return { reason: `undeclared parameter: ${name}` }
  const value = parameters[name]
  if (value === undefined || value === null) {
    return 'NULL'
  }
  switch (type) {
    case 'text':
      return `'${String(value).replace(/'/g, "''")}'`
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return { reason: `${name} must be an integer` }
      }
      return String(value)
    }
    case 'decimal': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { reason: `${name} must be a finite number` }
      }
      return String(value)
    }
    case 'boolean':
      return value === true ? 'true' : 'false'
    case 'date': {
      const text = String(value)
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text)) {
        return { reason: `${name} must be a YYYY-MM-DD date` }
      }
      return `'${text}'::date`
    }
    case 'timestamp': {
      const text = String(value)
      if (Number.isNaN(Date.parse(text))) {
        return { reason: `${name} must be an ISO timestamp` }
      }
      return `'${text}'::timestamptz`
    }
    default:
      return { reason: `${name} has an unsupported type: ${type}` }
  }
}
