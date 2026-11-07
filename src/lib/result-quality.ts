/**
 * Result quality: result limits, the incident log, legal holds and retention
 * rules. Each is a feature a model can have (`lib/features/registry.ts`).
 *
 * Limits belong to a number field on a record model. A value inside the limits
 * and the alert band passes, inside the limits but outside the band is an
 * alert, and outside the limits is out of specification. The database works
 * the verdict out when it is read (`record_spec_results`), and the same rule is
 * written here for forms that judge a value before it is saved.
 */
import { useQuery } from '@tanstack/react-query'

import { t } from '#/copy'
import { notebookDataClient } from '#/lib/notebook-data'
import type { DataClient } from '#/lib/data-client'
import { fetchModelsWithFeature, useModelFeatures } from '#/lib/features/data'
import {
  INCIDENT_LOG_FEATURE,
  LEGAL_HOLD_FEATURE,
  RESULT_LIMITS_FEATURE,
  RETENTION_FEATURE,
} from '#/lib/features/registry'

export const qualityKeys = {
  all: ['quality'] as const,
  limits: (kind: string) => ['quality', 'limits', kind] as const,
  recordResults: (recordId: string) =>
    ['quality', 'results', 'record', recordId] as const,
  kindResults: (kind: string) => ['quality', 'results', 'kind', kind] as const,
  incidentModels: ['quality', 'incident-models'] as const,
  incidents: (keys: readonly string[]) =>
    ['quality', 'incidents', ...keys] as const,
  holds: ['quality', 'holds'] as const,
  holdCounts: ['quality', 'hold-counts'] as const,
  rules: ['quality', 'rules'] as const,
  due: ['quality', 'due'] as const,
  recordHold: (recordId: string) =>
    ['quality', 'record-hold', recordId] as const,
}

export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// Which features are on ---------------------------------------------------------

/** Which quality features are switched on for models of this lab, by model key.
 * Nothing is on while the features load. */
export function useQualityFeatures(): {
  resultLimits: ReadonlySet<string>
  retention: ReadonlySet<string>
  legalHold: ReadonlySet<string>
  loading: boolean
} {
  const features = useModelFeatures()
  const keys = (feature: string) =>
    new Set(
      (features.data ?? [])
        .filter((f) => f.capability === feature)
        .map((f) => f.model_key),
    )
  return {
    resultLimits: keys(RESULT_LIMITS_FEATURE),
    retention: keys(RETENTION_FEATURE),
    legalHold: keys(LEGAL_HOLD_FEATURE),
    loading: features.isPending,
  }
}

// Result limits ----------------------------------------------------------------

export type SpecVerdict = 'pass' | 'alert' | 'fail'

export interface SpecLimits {
  lowerLimit: number | null
  upperLimit: number | null
  alertLower: number | null
  alertUpper: number | null
}

export const NO_LIMITS: SpecLimits = {
  lowerLimit: null,
  upperLimit: null,
  alertLower: null,
  alertUpper: null,
}

/** The verdict for one value; the same rule the database applies. */
export function specVerdict(
  value: number | null | undefined,
  limits: SpecLimits,
): SpecVerdict | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  const { lowerLimit, upperLimit, alertLower, alertUpper } = limits
  if (
    (lowerLimit !== null && value < lowerLimit) ||
    (upperLimit !== null && value > upperLimit)
  ) {
    return 'fail'
  }
  if (
    (alertLower !== null && value < alertLower) ||
    (alertUpper !== null && value > alertUpper)
  ) {
    return 'alert'
  }
  return 'pass'
}

/** The limits as a short phrase: "90 to 100", "at least 90", "at most 100". */
export function describeLimits(limits: SpecLimits): string {
  const { lowerLimit: lo, upperLimit: hi } = limits
  if (lo !== null && hi !== null)
    return t('quality.limits.rangeBetween', {
      low: String(lo),
      high: String(hi),
    })
  if (lo !== null) return t('quality.limits.rangeAtLeast', { low: String(lo) })
  if (hi !== null) return t('quality.limits.rangeAtMost', { high: String(hi) })
  return ''
}

/** Why a set of limits cannot be saved, or null when it can. */
export function limitsProblem(limits: SpecLimits): string | null {
  const {
    lowerLimit: lo,
    upperLimit: hi,
    alertLower: al,
    alertUpper: ah,
  } = limits
  const none = lo === null && hi === null && al === null && ah === null
  if (none) return null
  if (lo === null && hi === null) return 'needsLimit'
  if (lo !== null && hi !== null && lo > hi) return 'order'
  if (al !== null && lo !== null && al < lo) return 'alertOutside'
  if (ah !== null && hi !== null && ah > hi) return 'alertOutside'
  if (al !== null && ah !== null && al > ah) return 'order'
  return null
}

/** Read a typed number; an empty box means no limit. */
export function parseLimit(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

interface LimitsWire {
  field_name: string
  lower_limit: number | null
  upper_limit: number | null
  alert_lower: number | null
  alert_upper: number | null
  note: string | null
}

export interface FieldLimits extends SpecLimits {
  fieldName: string
  note: string | null
}

const toNumber = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

export async function fetchFieldLimits(
  client: DataClient,
  kind: string,
): Promise<FieldLimits[]> {
  const rows = await client.list<LimitsWire>(
    'field_spec_limits',
    `?kind=eq.${encodeURIComponent(kind)}&select=field_name,lower_limit,upper_limit,alert_lower,alert_upper,note`,
  )
  return rows.map((row) => ({
    fieldName: row.field_name,
    lowerLimit: toNumber(row.lower_limit),
    upperLimit: toNumber(row.upper_limit),
    alertLower: toNumber(row.alert_lower),
    alertUpper: toNumber(row.alert_upper),
    note: row.note,
  }))
}

export async function saveFieldLimits(
  client: DataClient,
  kind: string,
  fieldName: string,
  limits: SpecLimits,
  note?: string | null,
): Promise<void> {
  await client.rpc('set_field_spec_limits', {
    p_kind: kind,
    p_field_name: fieldName,
    p_lower: limits.lowerLimit,
    p_upper: limits.upperLimit,
    p_alert_lower: limits.alertLower,
    p_alert_upper: limits.alertUpper,
    p_note: note ?? null,
  })
}

export interface SpecResult {
  recordId: string
  fieldName: string
  value: number
  verdict: SpecVerdict
}

interface ResultWire {
  record_id: string
  field_name: string
  value: number | string
  verdict: SpecVerdict
}

const toResult = (row: ResultWire): SpecResult => ({
  recordId: row.record_id,
  fieldName: row.field_name,
  value: Number(row.value),
  verdict: row.verdict,
})

/** The verdicts for one record's limited fields. */
export async function fetchRecordResults(
  client: DataClient,
  recordId: string,
): Promise<SpecResult[]> {
  const rows = await client.list<ResultWire>(
    'record_spec_results',
    `?record_id=eq.${recordId}&select=record_id,field_name,value,verdict`,
  )
  return rows.map(toResult)
}

/** Every result of a model's live records, for its list. */
export async function fetchKindResults(
  client: DataClient,
  kind: string,
): Promise<SpecResult[]> {
  const rows = await client.list<ResultWire>(
    'record_spec_results',
    `?kind=eq.${encodeURIComponent(kind)}&select=record_id,field_name,value,verdict&limit=5000`,
  )
  return rows.map(toResult)
}

/** The worst verdict among some results: fail beats alert beats pass. */
export function worstVerdict(
  results: readonly { verdict: SpecVerdict }[],
): SpecVerdict | null {
  if (results.some((r) => r.verdict === 'fail')) return 'fail'
  if (results.some((r) => r.verdict === 'alert')) return 'alert'
  return results.length ? 'pass' : null
}

// Incident log -----------------------------------------------------------------

export interface IncidentModel {
  key: string
  name: string
  identifier_prefix: string
}

export interface IncidentEntry {
  id: string
  identifier: string
  title: string
  kind: string
  status: string
  custom_fields: Record<string, unknown> | null
  created_at: string
  archived_at: string | null
}

export async function fetchIncidentModels(
  client: DataClient,
): Promise<IncidentModel[]> {
  const models = await fetchModelsWithFeature(client, INCIDENT_LOG_FEATURE)
  return models.map(({ key, name, identifier_prefix }) => ({
    key,
    name,
    identifier_prefix,
  }))
}

export async function fetchIncidents(
  client: DataClient,
  kinds: readonly string[],
): Promise<IncidentEntry[]> {
  if (kinds.length === 0) return []
  const list = kinds.map((k) => encodeURIComponent(k)).join(',')
  return client.list<IncidentEntry>(
    'records',
    `?kind=in.(${list})&deleted_at=is.null&order=created_at.desc&limit=5000&select=id,identifier,title,kind,status,custom_fields,created_at,archived_at`,
  )
}

export interface StarterModelField {
  field_name: string
  label: string
  logical_type?: 'text' | 'date' | 'category' | 'integer' | 'decimal'
  section?: string
  show_in_list?: boolean
  options?: { key: string; label: string }[]
}

export interface StarterModel {
  key: string
  name: string
  prefix: string
  description: string
  fields: StarterModelField[]
}

/** The ready-made incident model. It is an ordinary model once set up. */
export const STARTER_INCIDENT_MODEL: StarterModel = {
  key: 'incident',
  name: 'Incident',
  prefix: 'INC',
  description: 'Incidents, deviations, near misses and complaints.',
  fields: [
    {
      field_name: 'kind',
      label: 'Type',
      logical_type: 'category',
      show_in_list: true,
      options: [
        { key: 'incident', label: 'Incident' },
        { key: 'deviation', label: 'Deviation' },
        { key: 'near_miss', label: 'Near miss' },
        { key: 'complaint', label: 'Complaint' },
      ],
    },
    {
      field_name: 'severity',
      label: 'Severity',
      logical_type: 'category',
      show_in_list: true,
      options: [
        { key: 'minor', label: 'Minor' },
        { key: 'major', label: 'Major' },
        { key: 'critical', label: 'Critical' },
      ],
    },
    {
      field_name: 'stage',
      label: 'Stage',
      logical_type: 'category',
      show_in_list: true,
      options: [
        { key: 'open', label: 'Open' },
        { key: 'investigating', label: 'Investigating' },
        { key: 'action_due', label: 'Action due' },
        { key: 'closed', label: 'Closed' },
      ],
    },
    { field_name: 'occurred_on', label: 'Happened on', logical_type: 'date' },
    { field_name: 'what_happened', label: 'What happened' },
    { field_name: 'immediate_action', label: 'What was done straight away' },
    { field_name: 'root_cause', label: 'Root cause' },
    { field_name: 'corrective_action', label: 'Corrective action' },
    {
      field_name: 'action_due_on',
      label: 'Action due by',
      logical_type: 'date',
    },
    { field_name: 'closed_on', label: 'Closed on', logical_type: 'date' },
  ],
}

export async function createStarterModel(
  client: DataClient,
  starter: StarterModel,
  options: { incidentLog: boolean },
): Promise<void> {
  await client.rpc('create_starter_model', {
    p_key: starter.key,
    p_name: starter.name,
    p_prefix: starter.prefix,
    p_description: starter.description,
    p_fields: starter.fields,
    p_incident_log: options.incidentLog,
  })
}

/** A stored value as a person reads it: keys become words, dates stay dates. */
export function readableValue(value: unknown): string {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(trimmed)) {
    const words = trimmed.replace(/_/g, ' ')
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
  return trimmed
}

/** The first few things filled in on an incident, as one line. */
export function incidentSummary(entry: IncidentEntry): string {
  return Object.values(entry.custom_fields ?? {})
    .map(readableValue)
    .filter((v) => v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v))
    .slice(0, 3)
    .join(' · ')
}

// Legal holds and retention -------------------------------------------------

export interface LegalHold {
  id: string
  name: string
  reason: string | null
  project_id: string | null
  kind: string | null
  created_at: string
  released_at: string | null
  release_note: string | null
}

export async function fetchLegalHolds(
  client: DataClient,
): Promise<LegalHold[]> {
  return client.list<LegalHold>(
    'legal_holds',
    '?select=id,name,reason,project_id,kind,created_at,released_at,release_note&order=created_at.desc',
  )
}

export async function fetchHoldCounts(
  client: DataClient,
): Promise<Map<string, number>> {
  const rows = await client.rpc<
    { hold_id: string; records: number | string }[]
  >('legal_hold_counts', {})
  return new Map(rows.map((r) => [r.hold_id, Number(r.records)]))
}

export async function createLegalHold(
  client: DataClient,
  input: {
    name: string
    reason: string
    projectId: string | null
    kind: string | null
  },
): Promise<void> {
  await client.rpc('create_legal_hold', {
    p_name: input.name,
    p_reason: input.reason || null,
    p_project_id: input.projectId,
    p_kind: input.kind,
    p_record_ids: [],
  })
}

export async function releaseLegalHold(
  client: DataClient,
  holdId: string,
  note: string,
): Promise<void> {
  await client.rpc('release_legal_hold', {
    p_hold_id: holdId,
    p_note: note || null,
  })
}

export async function isRecordOnHold(
  client: DataClient,
  recordId: string,
): Promise<boolean> {
  const held = await client.rpc<boolean | null>('is_record_on_hold', {
    p_record_id: recordId,
  })
  return held === true
}

export interface RetentionRule {
  id: string
  kind: string
  keep_months: number
  note: string | null
}

export async function fetchRetentionRules(
  client: DataClient,
): Promise<RetentionRule[]> {
  return client.list<RetentionRule>(
    'retention_rules',
    '?select=id,kind,keep_months,note&order=kind.asc',
  )
}

export async function saveRetentionRule(
  client: DataClient,
  kind: string,
  keepMonths: number | null,
  note: string,
): Promise<void> {
  await client.rpc('set_retention_rule', {
    p_kind: kind,
    p_keep_months: keepMonths,
    p_note: note || null,
  })
}

export interface DueRecord {
  record_id: string
  identifier: string
  title: string
  kind: string
  last_changed: string
  keep_months: number
  due_since: string
}

export async function fetchDueRecords(
  client: DataClient,
): Promise<DueRecord[]> {
  return client.rpc<DueRecord[]>('retention_due', {})
}

export async function applyRetention(client: DataClient): Promise<number> {
  return Number(await client.rpc<number>('apply_retention', {}))
}

/** A keep time as words: "2 years", "18 months". */
export function keepTimeLabel(months: number): string {
  return months % 12 === 0
    ? t('quality.retention.rules.years', { count: months / 12 })
    : t('quality.retention.rules.monthsCount', { count: months })
}

/** Everything the record page needs from the quality settings: the verdict of
 * each limited field, those fields' limits, and whether a hold freezes it. */
export function useRecordQuality(
  modelKey: string,
  recordId: string,
): {
  results: SpecResult[]
  limitsByField: Map<string, FieldLimits>
  onHold: boolean
} {
  const features = useQualityFeatures()
  const limitsOn = features.resultLimits.has(modelKey)
  const results = useQuery({
    queryKey: qualityKeys.recordResults(recordId),
    queryFn: () => fetchRecordResults(notebookDataClient, recordId),
    enabled: limitsOn,
  })
  const limits = useQuery({
    queryKey: qualityKeys.limits(modelKey),
    queryFn: () => fetchFieldLimits(notebookDataClient, modelKey),
    enabled: limitsOn,
  })
  const hold = useQuery({
    queryKey: qualityKeys.recordHold(recordId),
    queryFn: () => isRecordOnHold(notebookDataClient, recordId),
    staleTime: 30_000,
  })
  return {
    results: limitsOn ? (results.data ?? []) : [],
    limitsByField: new Map(
      (limits.data ?? []).map((l) => [l.fieldName, l] as const),
    ),
    onHold: hold.data === true,
  }
}
