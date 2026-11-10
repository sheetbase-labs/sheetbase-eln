export type CheckKind = 'iq' | 'oq'

export type CheckStatus = 'passed' | 'failed' | 'skipped'

export interface CheckResult {
  id: string
  kind: CheckKind
  title: string
  /** What the check does, in words a validation team can put in a protocol. */
  method: string
  /** What counts as a pass. */
  expected: string
  requirements: string[]
  status: CheckStatus
  /** What was found. */
  detail: string
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- A check records the JSONB evidence it gathered; a stored run is decoded against z.record(z.string(), z.json()) when it is read back.
  evidence: Record<string, unknown>
  durationMs: number
}

export interface ValidationRunRecord {
  id: string
  workspace_id: string
  run_by_user_id: string | null
  app_version: string
  migration: string | null
  status: 'passed' | 'failed'
  passed: number
  failed: number
  skipped: number
  results: CheckResult[]
  started_at: string
  finished_at: string
}
