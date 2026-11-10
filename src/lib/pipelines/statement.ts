import { z } from 'zod'
import { t } from '#/copy'
/**
 * AUTO-02 — transform statement boundary.
 *
 * A Pipeline transform is exactly one deterministic SELECT (optionally with a
 * leading WITH) over the materialized input temp tables. The static checks
 * here are defense-in-depth and better errors; the actual security boundary
 * is the `pipeline_sandbox` login role on its own connection (zero table grants, no role memberships,
 * temp-schema-only search_path, statement timeout and temp-file cap) that executes the
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
  '[a-z_]*_to_xml',
  'dblink',
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

  if (text.length === 0)
    return { ok: false, reason: t('data.pipelineStatement.statementEmpty') }

  // A single statement only: strip one trailing semicolon, then reject any
  // other semicolon.
  const normalized = text.replace(/;+$/, '')

  if (normalized.includes(';')) {
    return {
      ok: false,
      reason: t('data.pipelineStatement.onlySingleStatementAllowed'),
    }
  }

  const upper = normalized.toUpperCase()

  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { ok: false, reason: 'transform must be a single SELECT statement' }
  }

  if (normalized.includes('--')) {
    return { ok: false, reason: t('data.pipelineStatement.commentsAllowed') }
  }

  if (normalized.includes('/*')) {
    return { ok: false, reason: t('data.pipelineStatement.commentsAllowed') }
  }

  if (normalized.includes('$')) {
    return { ok: false, reason: 'dollar-quoting is not allowed' }
  }

  if (normalized.includes('\\')) {
    return {
      ok: false,
      reason: t('data.pipelineStatement.backslashEscapesAllowed'),
    }
  }

  for (const keyword of BLOCKED_KEYWORDS) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    if (new RegExp(`\\b${escaped}\\b`).test(upper)) {
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
  parameters: Partial<Record<string, z.core.util.JSONType>>,
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

    if (!literal.ok) {
      return literal
    }

    literals.set(name, literal.statement)
  }

  const result = statement.replace(placeholderRe, (_, name: string) => {
    return literals.get(name) ?? 'NULL'
  })

  return { ok: true, statement: result }
}

function literalForParameter(
  name: string,
  parameters: Partial<Record<string, z.core.util.JSONType>>,
  parameterTypes: Record<string, string>,
): { ok: true; statement: string } | { ok: false; reason: string } {
  const type = parameterTypes[name]

  if (!type) return { ok: false, reason: `undeclared parameter: ${name}` }
  const value = parameters[name]

  if (value === undefined || value === null) {
    return { ok: true, statement: 'NULL' }
  }

  switch (type) {
    case 'text':
      return {
        ok: true,
        statement: `'${z.coerce.string().parse(value).replace(/'/g, "''")}'`,
      }
    case 'integer': {
      const integer = z.number().refine(Number.isInteger).safeParse(value)

      if (!integer.success) {
        return { ok: false, reason: `${name} must be an integer` }
      }

      return { ok: true, statement: String(integer.data) }
    }

    case 'decimal': {
      const decimal = z.number().safeParse(value)

      if (!decimal.success) {
        return { ok: false, reason: `${name} must be a finite number` }
      }

      return { ok: true, statement: String(decimal.data) }
    }

    case 'boolean':
      return { ok: true, statement: value === true ? 'true' : 'false' }
    case 'date': {
      const text = z.coerce.string().parse(value)

      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(text)) {
        return { ok: false, reason: `${name} must be a YYYY-MM-DD date` }
      }

      return { ok: true, statement: `'${text}'::date` }
    }

    case 'timestamp': {
      const text = z.coerce.string().parse(value)

      if (Number.isNaN(Date.parse(text))) {
        return { ok: false, reason: `${name} must be an ISO timestamp` }
      }

      return { ok: true, statement: `'${text}'::timestamptz` }
    }

    default:
      return { ok: false, reason: `${name} has an unsupported type: ${type}` }
  }
}
