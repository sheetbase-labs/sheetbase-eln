import { t } from '#/copy'
import { OUT_OF_RANGE_COLUMN, VALUELESS_OPERATORS } from './forms'
import type {
  Condition,
  ConditionOperator,
  FilterForm,
  FlagForm,
  CalculateForm,
  CheckRangesForm,
  JoinForm,
  NoCodeForm,
  NoCodeKind,
} from './forms'

const OPERATOR_WORDS: Record<ConditionOperator, string> = {
  eq: '=',
  neq: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  contains: t('data.noCode.opContains'),
  starts_with: t('data.noCode.opStartsWith'),
  is_empty: t('data.noCode.opIsEmpty'),
  is_not_empty: t('data.noCode.opIsNotEmpty'),
}

export const operatorLabel = (op: ConditionOperator) => OPERATOR_WORDS[op]

function conditionText(condition: Condition): string {
  const column = condition.column || '…'

  if (VALUELESS_OPERATORS.includes(condition.op))
    return `${column} ${OPERATOR_WORDS[condition.op]}`

  return `${column} ${OPERATOR_WORDS[condition.op]} ${condition.value ?? ''}`.trim()
}

function conditionsText(conditions: Condition[], match: 'all' | 'any') {
  return conditions.map(conditionText).join(match === 'all' ? ' and ' : ' or ')
}

const formulaSymbol = { '+': '+', '-': '−', '*': '×', '/': '÷' } as const

export const formulaSymbolFor = (op: keyof typeof formulaSymbol) =>
  formulaSymbol[op]

/** One line that says what the form does, as the step list shows it. */
export function noCodeSummary(kind: NoCodeKind, form: NoCodeForm): string {
  switch (kind) {
    case 'filter': {
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      const f = form as FilterForm

      return f.conditions.length
        ? t('data.noCode.summaryFilter', {
            conditions: conditionsText(f.conditions, f.match),
          })
        : t('data.noCode.summaryFilterEmpty')
    }

    case 'flag': {
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      const f = form as FlagForm

      return t('data.noCode.summaryFlag', {
        column: f.column || '…',
        conditions: conditionsText(f.conditions, f.match),
      })
    }

    case 'join': {
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      const f = form as JoinForm

      return f.with
        ? t('data.noCode.summaryJoin', { input: f.with })
        : t('data.noCode.summaryJoinEmpty')
    }

    case 'calculate': {
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      const f = form as CalculateForm

      return t('data.noCode.summaryCalculate', { column: f.column || '…' })
    }

    case 'check_ranges': {
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      const f = form as CheckRangesForm

      return f.ranges
        .map((r) =>
          r.min !== undefined && r.max !== undefined
            ? `${r.column} ${r.min}–${r.max}`
            : r.max !== undefined
              ? `${r.column} ≤ ${r.max}`
              : `${r.column} ≥ ${r.min ?? ''}`,
        )
        .join(', ')
    }
  }
}

/** The columns a form reads, for "Uses" in the inspector. */
export function noCodeColumnsUsed(
  kind: NoCodeKind,
  form: NoCodeForm,
): string[] {
  const names: string[] = []

  switch (kind) {
    case 'filter':
    case 'flag':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      for (const c of (form as FilterForm | FlagForm).conditions)
        names.push(c.column)
      break
    case 'join':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      for (const k of (form as JoinForm).keys) names.push(k.left)
      break
    case 'calculate':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      for (const term of (form as CalculateForm).terms)
        if (term.column) names.push(term.column)
      break
    case 'check_ranges':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      for (const r of (form as CheckRangesForm).ranges) names.push(r.column)
      break
  }

  return [...new Set(names.filter(Boolean))]
}

/** The columns a form adds. */
export function noCodeColumnsWritten(
  kind: NoCodeKind,
  form: NoCodeForm,
): string[] {
  switch (kind) {
    case 'calculate':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      return [(form as CalculateForm).column].filter(Boolean)
    case 'flag':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      return [(form as FlagForm).column].filter(Boolean)
    case 'check_ranges':
      return [OUT_OF_RANGE_COLUMN]
    case 'join':
      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      return (form as JoinForm).bring
    case 'filter':
      return []
  }
}

/** A form to start from. */
export function defaultForm(kind: NoCodeKind): NoCodeForm {
  switch (kind) {
    case 'filter':
      return { match: 'all', conditions: [{ column: '', op: 'eq', value: '' }] }
    case 'flag':
      return {
        column: 'flagged',
        match: 'all',
        conditions: [{ column: '', op: 'gt', value: '' }],
      }
    case 'join':
      return {
        with: '',
        type: 'left',
        keys: [{ left: '', right: '' }],
        bring: [],
      }
    case 'calculate':
      return {
        column: 'result',
        terms: [{ column: '' }, { op: '/', column: '' }],
        places: 1,
      }
    case 'check_ranges':
      return { ranges: [{ column: '' }], keep: 'all' }
  }
}
