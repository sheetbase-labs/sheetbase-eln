/**
 * Rules in words, and the checks a rule form makes before it asks the database
 * (which checks again). Pure: no data is read here.
 */
import { t } from '#/copy'
import type {
  ContractMode,
  ContractRule,
  ContractRuleKind,
  ContractRuleResult,
  ContractStatus,
  ContractTarget,
} from './types'
import { FIELD_RULE_KINDS } from './types'

export const isFieldRule = (kind: ContractRuleKind): boolean =>
  FIELD_RULE_KINDS.includes(kind)

const RANK: Record<ContractStatus, number> = { pass: 0, warning: 1, fail: 2 }

/** The worse of two standings; "not checked" (null) is the best. */
export function worseStatus(
  a: ContractStatus | null | undefined,
  b: ContractStatus | null | undefined,
): ContractStatus | null {
  if (!a) return b ?? null

  if (!b) return a

  return RANK[a] >= RANK[b] ? a : b
}

/** A quantity of minutes as the biggest whole unit: "2 days", "90 minutes". */
export function describeMinutes(minutes: number): string {
  if (minutes % 1440 === 0)
    return t('contracts.duration.days', { count: minutes / 1440 })

  if (minutes % 60 === 0)
    return t('contracts.duration.hours', { count: minutes / 60 })

  return t('contracts.duration.minutes', { count: minutes })
}

/** "0 to 100", "at least 5", "at most 9". */
export function describeLimits(
  min: number | undefined,
  max: number | undefined,
): string {
  if (min !== undefined && max !== undefined)
    return t('contracts.limits.between', { min, max })

  if (min !== undefined) return t('contracts.limits.atLeast', { min })

  if (max !== undefined) return t('contracts.limits.atMost', { max })

  return ''
}

/** What a rule asks for, in a phrase. */
export function describeRule(rule: ContractRule): string {
  switch (rule.kind) {
    case 'required':
      return t('contracts.rule.required')
    case 'unique':
      return t('contracts.rule.unique')
    case 'range':
      return t('contracts.rule.range', {
        limits: describeLimits(rule.min, rule.max),
      })
    case 'units':
      return t('contracts.rule.units', { units: (rule.units ?? []).join(', ') })
    case 'completeness':
      return t('contracts.rule.completeness', { percent: rule.threshold ?? 0 })
    case 'row_count':
      return t('contracts.rule.rowCount', {
        limits: describeLimits(rule.min, rule.max),
      })
    case 'freshness':
      return t('contracts.rule.freshness', {
        every: describeMinutes(rule.maxAgeMinutes ?? 0),
      })
  }
}

export function kindLabel(kind: ContractRuleKind): string {
  return t(`contracts.kind.${kind}`)
}

export function modeLabel(mode: ContractMode): string {
  return t(`contracts.mode.${mode}`)
}

export function statusLabel(status: ContractStatus | null | undefined): string {
  return status
    ? t(`contracts.status.${status}`)
    : t('contracts.status.unchecked')
}

/** What a rule found, in a phrase. `limit` is what the rule asked for. */
export function describeFinding(
  result: ContractRuleResult,
  rule: ContractRule | undefined,
  fieldLabel: string,
): string {
  if (result.status === 'skipped') {
    if (result.reason === 'field_missing')
      return t('contracts.finding.fieldMissing', { field: fieldLabel })

    if (result.reason === 'no_rows') return t('contracts.finding.noRows')

    return t('contracts.finding.batch')
  }

  const failed = result.failed ?? 0
  const checked = result.checked ?? 0

  switch (result.kind) {
    case 'required':
      return t('contracts.finding.required', { count: failed, total: checked })
    case 'unique':
      return t('contracts.finding.unique', { count: failed })
    case 'range':
      return t('contracts.finding.range', {
        count: failed,
        total: checked,
        limits: describeLimits(rule?.min, rule?.max),
      })
    case 'completeness':
      return t('contracts.finding.completeness', {
        percent: result.percent ?? 0,
        threshold: result.threshold ?? rule?.threshold ?? 0,
      })
    case 'units':
      return result.actual
        ? t('contracts.finding.unit', { actual: result.actual })
        : t('contracts.finding.noUnit')
    case 'row_count':
      return t('contracts.finding.rowCount', {
        count: result.rowCount ?? 0,
        limits: describeLimits(rule?.min, rule?.max),
      })
    case 'freshness':
      return t('contracts.finding.freshness', {
        age: describeMinutes(result.ageMinutes ?? 0),
        limit: describeMinutes(
          result.maxAgeMinutes ?? rule?.maxAgeMinutes ?? 0,
        ),
      })
  }
}

/** A form's text for one rule, before it is a rule. */
export interface RuleDraft {
  kind: ContractRuleKind
  field: string
  mode: ContractMode
  min: string
  max: string
  units: string
  threshold: string
  maxAge: string
  maxAgeUnit: 'minutes' | 'hours' | 'days'
}

export const BLANK_DRAFT: RuleDraft = {
  kind: 'required',
  field: '',
  mode: 'warn',
  min: '',
  max: '',
  units: '',
  threshold: '',
  maxAge: '',
  maxAgeUnit: 'days',
}

const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440 } as const

function num(text: string): number | undefined {
  const trimmed = text.trim()

  if (trimmed === '') return undefined
  const n = Number(trimmed)

  return Number.isFinite(n) ? n : Number.NaN
}

/** Why a draft cannot be a rule yet, or null when it can. */
export function draftProblem(draft: RuleDraft): string | null {
  if (isFieldRule(draft.kind) && !draft.field)
    return t('contracts.problem.needsField')
  const min = num(draft.min)
  const max = num(draft.max)

  if (Number.isNaN(min) || Number.isNaN(max))
    return t('contracts.problem.notNumbers')

  if (draft.kind === 'range' || draft.kind === 'row_count') {
    if (min === undefined && max === undefined)
      return t('contracts.problem.needsLimit')

    if (min !== undefined && max !== undefined && min > max)
      return t('contracts.problem.order')

    if (draft.kind === 'row_count') {
      if (
        (min !== undefined && (min < 0 || !Number.isInteger(min))) ||
        (max !== undefined && (max < 0 || !Number.isInteger(max)))
      )
        return t('contracts.problem.wholeRows')
    }
  }

  if (draft.kind === 'units' && splitUnits(draft.units).length === 0)
    return t('contracts.problem.needsUnits')

  if (draft.kind === 'completeness') {
    const threshold = num(draft.threshold)

    if (
      threshold === undefined ||
      Number.isNaN(threshold) ||
      threshold <= 0 ||
      threshold > 100
    )
      return t('contracts.problem.percent')
  }

  if (draft.kind === 'freshness') {
    const age = num(draft.maxAge)

    if (
      age === undefined ||
      Number.isNaN(age) ||
      age <= 0 ||
      !Number.isInteger(age * UNIT_MINUTES[draft.maxAgeUnit])
    )
      return t('contracts.problem.age')
  }

  return null
}

export function splitUnits(text: string): string[] {
  return text
    .split(',')
    .map((unit) => unit.trim())
    .filter(Boolean)
}

/** The rule a valid draft stands for. The id is made by the database. */
export function draftToRule(draft: RuleDraft, id?: string): ContractRule {
  const rule: ContractRule = {
    id: id ?? '',
    kind: draft.kind,
    mode: draft.mode,
  }

  if (isFieldRule(draft.kind)) rule.field = draft.field

  if (draft.kind === 'range' || draft.kind === 'row_count') {
    const min = num(draft.min)
    const max = num(draft.max)

    if (min !== undefined) rule.min = min

    if (max !== undefined) rule.max = max
  }

  if (draft.kind === 'units') rule.units = splitUnits(draft.units)

  if (draft.kind === 'completeness') rule.threshold = num(draft.threshold)

  if (draft.kind === 'freshness')
    rule.maxAgeMinutes = Math.round(
      (num(draft.maxAge) ?? 0) * UNIT_MINUTES[draft.maxAgeUnit],
    )

  return rule
}

export function ruleToDraft(rule: ContractRule): RuleDraft {
  const draft: RuleDraft = {
    ...BLANK_DRAFT,
    kind: rule.kind,
    field: rule.field ?? '',
    mode: rule.mode,
    min: rule.min === undefined ? '' : String(rule.min),
    max: rule.max === undefined ? '' : String(rule.max),
    units: (rule.units ?? []).join(', '),
    threshold: rule.threshold === undefined ? '' : String(rule.threshold),
  }

  if (rule.maxAgeMinutes !== undefined) {
    const minutes = rule.maxAgeMinutes

    if (minutes % 1440 === 0) {
      draft.maxAge = String(minutes / 1440)
      draft.maxAgeUnit = 'days'
    } else if (minutes % 60 === 0) {
      draft.maxAge = String(minutes / 60)
      draft.maxAgeUnit = 'hours'
    } else {
      draft.maxAge = String(minutes)
      draft.maxAgeUnit = 'minutes'
    }
  }

  return draft
}

/** The same rule twice would only repeat itself: is this one already there? */
export function sameRule(a: ContractRule, b: ContractRule): boolean {
  return (
    a.kind === b.kind &&
    (a.field ?? '') === (b.field ?? '') &&
    a.min === b.min &&
    a.max === b.max &&
    a.threshold === b.threshold &&
    a.maxAgeMinutes === b.maxAgeMinutes &&
    (a.units ?? []).join('|') === (b.units ?? []).join('|')
  )
}

/** The model a contract belongs to, as the target the client functions take. */
export function contractTarget(contract: {
  datasetSchemaId: string | null
  recordModelKey: string | null
}): ContractTarget {
  return contract.datasetSchemaId
    ? { kind: 'dataset_schema', id: contract.datasetSchemaId }
    : { kind: 'record_model', key: contract.recordModelKey ?? '' }
}
