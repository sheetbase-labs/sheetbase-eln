import { t } from '#/copy'
import { checkTransformStatement } from '../statement'
import { OUT_OF_RANGE_COLUMN } from './forms'
import type {
  CalculateForm,
  CheckRangesForm,
  Condition,
  FilterForm,
  FlagForm,
  JoinForm,
  NoCodeForm,
  NoCodeKind,
} from './forms'

export type Generated =
  { ok: true; statement: string } | { ok: false; reason: string }

const bad = (reason: string): Generated => ({ ok: false, reason })

/** A column or table name as SQL, refused when it could end the identifier or the statement. */
function ident(name: string): string | null {
  const text = name.trim()

  if (!text || text.length > 63 || unsafeIdent(text)) return null

  return `"${text}"`
}

/** A typed value as SQL: a number when it is one, otherwise quoted text. */
/** Whether text holds a control character. */
function hasControl(text: string): boolean {
  for (let index = 0; index < text.length; index++)
    if (text.charCodeAt(index) < 32) return true

  return false
}

/** Text that could end a statement, open a comment or a quote, or carry a control character. */
function unsafeText(text: string, extra: string[]): boolean {
  return (
    hasControl(text) ||
    [';', '$', '--', '/*', ...extra].some((part) => text.includes(part))
  )
}

function unsafeIdent(text: string): boolean {
  return unsafeText(text, ['"'])
}

function literal(value: string, text: boolean | undefined): string | null {
  const raw = value.trim()

  if (!text && /^-?[0-9]+(\.[0-9]+)?$/.test(raw)) return raw

  if (unsafeText(value, [])) return null

  return `'${value.replace(/'/g, "''")}'`
}

function numberLiteral(value: number): string | null {
  return Number.isFinite(value) ? String(value) : null
}

const COMPARE = {
  eq: '=',
  neq: '<>',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
} as const

/** One condition as a SQL test on `alias.column` (or the bare column). */
function conditionSql(condition: Condition, prefix = ''): string | null {
  const column = ident(condition.column)

  if (!column) return null
  const target = `${prefix}${column}`

  switch (condition.op) {
    case 'is_empty':
      return `(${target} IS NULL OR CAST(${target} AS text) = '')`
    case 'is_not_empty':
      return `(${target} IS NOT NULL AND CAST(${target} AS text) <> '')`
    case 'contains':
    case 'starts_with': {
      const value = condition.value ?? ''

      if (!value || unsafeText(value, ['%', '_'])) return null
      const pattern = `${condition.op === 'contains' ? '%' : ''}${value.replace(/'/g, "''")}%`

      return `CAST(${target} AS text) ILIKE '${pattern}'`
    }

    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const value = (condition.value ?? '').trim()

      if (!/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return null

      return `${target} ${COMPARE[condition.op]} ${value}`
    }

    default: {
      const value = literal(condition.value ?? '', condition.text)

      if (value === null) return null

      return `${target} ${COMPARE[condition.op]} ${value}`
    }
  }
}

function conditionsSql(
  conditions: Condition[],
  match: 'all' | 'any',
): Generated {
  if (!conditions.length) return bad(t('data.noCode.needCondition'))
  const parts: string[] = []

  for (const condition of conditions) {
    if (!condition.column.trim()) return bad(t('data.noCode.chooseColumn'))
    const part = conditionSql(condition)

    if (part === null)
      return bad(
        t('data.noCode.badCondition', { column: condition.column.trim() }),
      )
    parts.push(part)
  }

  return {
    ok: true,
    statement: parts.join(match === 'all' ? ' AND ' : ' OR '),
  }
}

function filterSql(form: FilterForm): Generated {
  const where = conditionsSql(form.conditions, form.match)

  if (!where.ok) return where

  return {
    ok: true,
    statement: `SELECT * FROM previous WHERE ${where.statement}`,
  }
}

function flagSql(form: FlagForm): Generated {
  const column = ident(form.column)

  if (!column) return bad(t('data.noCode.nameNewColumn'))
  const test = conditionsSql(form.conditions, form.match)

  if (!test.ok) return test

  return {
    ok: true,
    statement: `SELECT *, CASE WHEN ${test.statement} THEN true ELSE false END AS ${column} FROM previous`,
  }
}

function joinSql(form: JoinForm): Generated {
  const table = ident(form.with)

  if (!table) return bad(t('data.noCode.chooseInputJoin'))

  if (!form.keys.length) return bad(t('data.noCode.chooseJoinKey'))
  const on: string[] = []

  for (const key of form.keys) {
    const left = ident(key.left)
    const right = ident(key.right)

    if (!left || !right) return bad(t('data.noCode.chooseJoinKey'))
    on.push(`p.${left} = j.${right}`)
  }

  const bring: string[] = []

  for (const name of form.bring) {
    const column = ident(name)

    if (!column) return bad(t('data.noCode.chooseColumn'))
    bring.push(`j.${column}`)
  }

  const kind = form.type === 'left' ? 'LEFT JOIN' : 'INNER JOIN'

  return {
    ok: true,
    statement: `SELECT p.*${bring.map((b) => `, ${b}`).join('')} FROM previous AS p ${kind} ${table} AS j ON ${on.join(' AND ')}`,
  }
}

function calculateSql(form: CalculateForm): Generated {
  const target = ident(form.column)

  if (!target || !/^[a-z][a-z0-9_]{0,47}$/.test(form.column.trim()))
    return bad(t('data.noCode.nameNewColumn'))

  if (!form.terms.length) return bad(t('data.noCode.needFormula'))
  let expression = ''

  for (const [index, term] of form.terms.entries()) {
    let operand: string | null

    if (term.column !== undefined) {
      const column = ident(term.column)

      operand = column ? `CAST(${column} AS numeric)` : null
    } else if (term.number !== undefined) {
      operand = numberLiteral(term.number)
    } else operand = null

    if (operand === null) return bad(t('data.noCode.finishFormula'))

    if (index === 0) {
      expression = operand
      continue
    }

    if (!term.op) return bad(t('data.noCode.finishFormula'))

    // Division by zero gives an empty value instead of stopping the run.
    expression +=
      term.op === '/' ? ` / NULLIF(${operand}, 0)` : ` ${term.op} ${operand}`
  }

  if (form.places !== null) {
    if (!Number.isInteger(form.places) || form.places < 0 || form.places > 9)
      return bad(t('data.noCode.placesRange'))
    expression = `ROUND(${expression}, ${form.places})`
  }

  return {
    ok: true,
    statement: `SELECT *, ${expression} AS ${target} FROM previous`,
  }
}

function rangesSql(form: CheckRangesForm): Generated {
  if (!form.ranges.length) return bad(t('data.noCode.needRange'))
  const outside: Array<{ column: string; test: string }> = []

  for (const range of form.ranges) {
    const column = ident(range.column)

    if (!column) return bad(t('data.noCode.chooseColumn'))
    const tests: string[] = []

    for (const [limit, op] of [
      [range.min, '<'],
      [range.max, '>'],
    ] as const) {
      if (limit === undefined) continue
      const value = numberLiteral(limit)

      if (value === null) return bad(t('data.noCode.rangeNumbers'))
      tests.push(`CAST(${column} AS numeric) ${op} ${value}`)
    }

    if (!tests.length) return bad(t('data.noCode.rangeLimit'))
    outside.push({
      column: range.column.trim().replace(/'/g, "''"),
      test: tests.join(' OR '),
    })
  }

  const flag = `NULLIF(CONCAT_WS(', ', ${outside
    .map((o) => `CASE WHEN ${o.test} THEN '${o.column}' END`)
    .join(', ')}), '')`

  const base = `SELECT *, ${flag} AS "${OUT_OF_RANGE_COLUMN}" FROM previous`

  return {
    ok: true,
    statement:
      form.keep === 'outside'
        ? `SELECT * FROM (${base}) AS checked WHERE "${OUT_OF_RANGE_COLUMN}" IS NOT NULL`
        : base,
  }
}

/** The SQL a form writes, or why it cannot be written yet. The result passes the statement checks. */
export function noCodeStatement(kind: NoCodeKind, form: NoCodeForm): Generated {
  let made: Generated

  switch (kind) {
    case 'filter':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      made = filterSql(form as FilterForm)
      break
    case 'join':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      made = joinSql(form as JoinForm)
      break
    case 'calculate':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      made = calculateSql(form as CalculateForm)
      break
    case 'check_ranges':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      made = rangesSql(form as CheckRangesForm)
      break
    case 'flag':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      made = flagSql(form as FlagForm)
      break
  }

  if (!made.ok) return made
  const check = checkTransformStatement(made.statement)

  return check.ok ? made : bad(check.reason)
}
