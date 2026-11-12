/**
 * The no-code step kinds. A form step keeps the settings a person picked
 * (`form`) and the SQL those settings write (`statement`). The runner runs the
 * statement like any SQL step; the form is what the editor shows and edits.
 * `Edit as SQL…` turns a form step into a plain SQL step, one way.
 */

export const NO_CODE_KINDS = [
  'filter',
  'join',
  'calculate',
  'check_ranges',
  'flag',
] as const

export type NoCodeKind = (typeof NO_CODE_KINDS)[number]

export function isNoCodeKind(kind: string): kind is NoCodeKind {
  return NO_CODE_KINDS.some((known) => known === kind)
}

export const CONDITION_OPERATORS = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'starts_with',
  'is_empty',
  'is_not_empty',
] as const

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number]

/** The operators that compare numbers. */
export const NUMERIC_OPERATORS: readonly ConditionOperator[] = [
  'lt',
  'lte',
  'gt',
  'gte',
]

/** The operators that take no value. */
export const VALUELESS_OPERATORS: readonly ConditionOperator[] = [
  'is_empty',
  'is_not_empty',
]

export interface Condition {
  column: string
  op: ConditionOperator
  /** Typed as text; a number is taken as one for the numeric operators and, unless `text` is set, for eq and neq. */
  value?: string
  /** Compare as text even when the value looks like a number. */
  text?: boolean
}

export interface FilterForm {
  /** Keep a row that meets all of the conditions, or any of them. */
  match: 'all' | 'any'
  conditions: Condition[]
}

export interface JoinForm {
  /** The name of a declared input. */
  with: string
  type: 'inner' | 'left'
  keys: Array<{ left: string; right: string }>
  /** The columns of the input brought in. */
  bring: string[]
}

export const FORMULA_OPERATORS = ['+', '-', '*', '/'] as const

export type FormulaOperator = (typeof FORMULA_OPERATORS)[number]

/** One term of a formula: a column or a number, after an operator (not the first). */
export interface FormulaTerm {
  op?: FormulaOperator
  column?: string
  number?: number
}

export interface CalculateForm {
  column: string
  terms: FormulaTerm[]
  /** Decimal places to round to; null leaves the result as it is. */
  places: number | null
  /** A unit to show beside the column; never part of the SQL. */
  unit?: string
}

export interface Range {
  column: string
  min?: number
  max?: number
}

export interface CheckRangesForm {
  ranges: Range[]
  /** Pass every row on (marking the ones outside) or only those outside. */
  keep: 'all' | 'outside'
}

export interface FlagForm {
  /** The new yes/no column. */
  column: string
  match: 'all' | 'any'
  conditions: Condition[]
}

export interface NoCodeForms {
  filter: FilterForm
  join: JoinForm
  calculate: CalculateForm
  check_ranges: CheckRangesForm
  flag: FlagForm
}

export type NoCodeForm = NoCodeForms[NoCodeKind]

/** The column a Check ranges step adds: the names of the columns outside their range, or empty. */
export const OUT_OF_RANGE_COLUMN = 'out_of_range'

export const MAX_CONDITIONS = 20
export const MAX_TERMS = 12
export const MAX_RANGES = 20
