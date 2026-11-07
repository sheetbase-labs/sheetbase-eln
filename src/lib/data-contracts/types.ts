/**
 * Data contracts as the app reads them. A contract sits on a dataset schema or
 * a record model and holds rules; every check is kept as a run.
 */

export const CONTRACT_RULE_KINDS = [
  'required',
  'unique',
  'range',
  'units',
  'completeness',
  'row_count',
  'freshness',
] as const
export type ContractRuleKind = (typeof CONTRACT_RULE_KINDS)[number]

/** Rules about one field; the rest are about the whole dataset. */
export const FIELD_RULE_KINDS: readonly ContractRuleKind[] = [
  'required',
  'unique',
  'range',
  'units',
  'completeness',
]

export type ContractMode = 'warn' | 'block'
export type ContractStatus = 'pass' | 'warning' | 'fail'
export type ContractLifecycle = 'draft' | 'active' | 'retired'
export type ContractTrigger = 'import' | 'pipeline' | 'manual' | 'schedule'

export interface ContractRule {
  id: string
  kind: ContractRuleKind
  field?: string
  mode: ContractMode
  min?: number
  max?: number
  units?: string[]
  /** Completeness: the lowest share of rows that must be filled in, 1 to 100. */
  threshold?: number
  maxAgeMinutes?: number
  note?: string
}

export interface DataContract {
  id: string
  workspaceId: string
  datasetSchemaId: string | null
  recordModelKey: string | null
  name: string
  description: string | null
  ownerUserId: string | null
  version: number
  lifecycle: ContractLifecycle
  rules: ContractRule[]
  scheduleMinutes: number | null
  nextCheckAt: string | null
  lastStatus: ContractStatus | null
  lastCheckedAt: string | null
  updatedAt: string
}

/** What a model is: a dataset schema (by id) or a record model (by key). */
export type ContractTarget =
  | { kind: 'dataset_schema'; id: string }
  | { kind: 'record_model'; key: string }

export interface ContractSample {
  row: string
  value?: string
}

/** What one rule found in one check. No display text: the app words it. */
export interface ContractRuleResult {
  ruleId: string
  kind: ContractRuleKind
  field?: string
  mode: ContractMode
  status: 'pass' | 'fail' | 'skipped'
  reason?: 'field_missing' | 'batch' | 'no_rows'
  checked?: number
  failed?: number
  samples?: ContractSample[]
  actual?: string | null
  percent?: number
  threshold?: number
  rowCount?: number
  ageMinutes?: number
  maxAgeMinutes?: number
}

export interface ContractRun {
  id: string
  contractId: string
  contractVersion: number
  datasetId: string | null
  trigger: ContractTrigger
  scope: 'stored' | 'batch'
  status: ContractStatus
  rowsChecked: number
  failedRules: number
  blocked: boolean
  results: ContractRuleResult[]
  createdAt: string
}

/** What the gate before an import or pipeline commit says. */
export interface ContractGateReport {
  ok: boolean
  checked: boolean
  blocked?: boolean
  status?: ContractStatus
  runId?: string
  contractId?: string
  contractName?: string
  rowsChecked?: number
  /** Only the rules that found a problem. */
  results?: ContractRuleResult[]
}

/** One dataset's latest full check under its schema's contract. */
export interface ContractDatasetStatus {
  contractId: string
  datasetId: string
  status: ContractStatus
  failedRules: number
  runId: string
  checkedAt: string
}

export interface ContractPreviewEntry {
  datasetId: string | null
  datasetName?: string
  datasetDisplayId?: string
  status: ContractStatus
  rowsChecked: number
  failedRules: number
  results: ContractRuleResult[]
}
