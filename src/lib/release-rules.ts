/**
 * The checks a sample has to pass before it can be released. A workspace sets
 * them per sample type (or once for every type); with none set, the built-in
 * check applies. The release button and the sample page read the same rules the
 * database enforces, so what a person edits here is what is checked.
 */
import { t } from '#/copy'
import type { DataClient } from '#/lib/data-client'

export type ReleaseRule =
  | { kind: 'no_result'; result: string; label?: string }
  | { kind: 'min_measurements'; count: number; label?: string }
  | { kind: 'measurement_required'; measurement: string; label?: string }
  | {
      kind: 'measurement_range'
      measurement: string
      min?: number
      max?: number
      label?: string
    }

export type ReleaseRuleKind = ReleaseRule['kind']

export const RULE_KINDS: readonly ReleaseRuleKind[] = [
  'no_result',
  'min_measurements',
  'measurement_required',
  'measurement_range',
]

/** The type every sample falls back to when its own type has no rules. */
export const ALL_TYPES = '*'

/** What applies when a workspace sets nothing. Mirrors the database default. */
export const BUILT_IN_RULES: readonly ReleaseRule[] = [
  { kind: 'no_result', result: 'fail', label: 'No failed measurement' },
]

export interface ReleaseRuleSet {
  sampleType: string
  rules: ReleaseRule[]
  updatedAt: string | null
}

interface RuleRow {
  sample_type: string
  rules: unknown
  updated_at: string | null
}

function asRule(raw: unknown): ReleaseRule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const label = typeof r.label === 'string' && r.label ? r.label : undefined
  const text = (key: string) => (typeof r[key] === 'string' ? r[key] : '')
  const num = (key: string) => {
    const n = r[key]
    return typeof n === 'number' || (typeof n === 'string' && n !== '')
      ? Number(n)
      : undefined
  }
  switch (r.kind) {
    case 'no_result':
      return { kind: 'no_result', result: text('result') || 'fail', label }
    case 'min_measurements':
      return { kind: 'min_measurements', count: num('count') ?? 1, label }
    case 'measurement_required':
      return {
        kind: 'measurement_required',
        measurement: text('measurement'),
        label,
      }
    case 'measurement_range':
      return {
        kind: 'measurement_range',
        measurement: text('measurement'),
        min: num('min'),
        max: num('max'),
        label,
      }
    default:
      return null
  }
}

export async function fetchReleaseRuleSets(
  client: DataClient,
): Promise<ReleaseRuleSet[]> {
  const rows = await client.list<RuleRow>(
    'sample_release_rules',
    '?select=sample_type,rules,updated_at&order=sample_type',
  )
  return rows.map((row) => ({
    sampleType: row.sample_type,
    rules: (Array.isArray(row.rules) ? row.rules : [])
      .map(asRule)
      .filter((rule): rule is ReleaseRule => rule !== null),
    updatedAt: row.updated_at,
  }))
}

/** The sample types in use, so a rule set can be started for one. */
export async function fetchSampleTypes(client: DataClient): Promise<string[]> {
  const rows = await client.list<{ type: string | null }>(
    'records',
    '?kind=eq.sample&archived_at=is.null&select=type:properties->>sampleType&limit=5000',
  )
  return [
    ...new Set(
      rows.map((row) => row.type?.trim()).filter((v): v is string => !!v),
    ),
  ].sort((a, b) => a.localeCompare(b))
}

/** The rule as the database stores it: no empty fields. */
export function ruleToWire(rule: ReleaseRule): Record<string, unknown> {
  const out: Record<string, unknown> = { kind: rule.kind }
  if (rule.label?.trim()) out.label = rule.label.trim()
  if (rule.kind === 'no_result') out.result = rule.result.trim()
  if (rule.kind === 'min_measurements') out.count = rule.count
  if (rule.kind === 'measurement_required' || rule.kind === 'measurement_range')
    out.measurement = rule.measurement.trim()
  if (rule.kind === 'measurement_range') {
    if (rule.min !== undefined) out.min = rule.min
    if (rule.max !== undefined) out.max = rule.max
  }
  return out
}

export async function saveReleaseRules(
  client: DataClient,
  workspaceId: string,
  sampleType: string,
  rules: readonly ReleaseRule[],
): Promise<void> {
  await client.rpc('set_sample_release_rules', {
    p_workspace_id: workspaceId,
    p_sample_type: sampleType,
    p_rules: rules.map(ruleToWire),
  })
}

/** Back to the built-in check for this type. */
export async function resetReleaseRules(
  client: DataClient,
  sampleType: string,
): Promise<void> {
  await client.remove(
    'sample_release_rules',
    `?sample_type=eq.${encodeURIComponent(sampleType)}`,
  )
}

/** The first thing wrong with a rule, in words a scientist would use. */
export function validateRule(rule: ReleaseRule): string | null {
  switch (rule.kind) {
    case 'no_result':
      return rule.result.trim() ? null : t('settings.releaseRules.needResult')
    case 'min_measurements':
      return Number.isInteger(rule.count) && rule.count >= 1
        ? null
        : t('settings.releaseRules.needCount')
    case 'measurement_required':
      return rule.measurement.trim()
        ? null
        : t('settings.releaseRules.needMeasurement')
    case 'measurement_range':
      if (!rule.measurement.trim())
        return t('settings.releaseRules.needMeasurement')
      if (
        (rule.min !== undefined && Number.isNaN(rule.min)) ||
        (rule.max !== undefined && Number.isNaN(rule.max))
      )
        return t('settings.releaseRules.limitsAreNumbers')
      if (rule.min === undefined && rule.max === undefined)
        return t('settings.releaseRules.needALimit')
      if (
        rule.min !== undefined &&
        rule.max !== undefined &&
        rule.min > rule.max
      )
        return t('settings.releaseRules.minAboveMax')
      return null
  }
}

/** One line saying what the check needs. */
export function describeRule(rule: ReleaseRule): string {
  switch (rule.kind) {
    case 'no_result':
      return t('settings.releaseRules.describe.noResult', {
        result: rule.result,
      })
    case 'min_measurements':
      return t('settings.releaseRules.describe.minMeasurements', {
        count: rule.count,
      })
    case 'measurement_required':
      return t('settings.releaseRules.describe.required', {
        measurement: rule.measurement,
      })
    case 'measurement_range': {
      const { min, max, measurement } = rule
      if (min !== undefined && max !== undefined)
        return t('settings.releaseRules.describe.between', {
          measurement,
          min,
          max,
        })
      if (min !== undefined)
        return t('settings.releaseRules.describe.atLeast', { measurement, min })
      return t('settings.releaseRules.describe.atMost', {
        measurement,
        max: max ?? 0,
      })
    }
  }
}

export const releaseRuleKeys = {
  all: (workspaceId: string) => ['release-rules', workspaceId] as const,
}
