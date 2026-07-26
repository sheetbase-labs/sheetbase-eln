/**
 * REV-005: reviewer check definitions and data-integrity check results.
 *
 * Wire shapes, data functions and query keys for the review-check surface.
 * The browser invokes `run_revision_checks` through the same-origin
 * `/api/db/rpc` boundary and reads immutable results from the
 * `review_check_results` REST resource. Check results are bound to a frozen
 * revision — they never reference live record state.
 */

import type { DataClient } from './data-client'

// ---------------------------------------------------------------------------
// Check definition shapes (the configurable checklist configuration).
// ---------------------------------------------------------------------------

export type CheckSeverity = 'blocking' | 'warning' | 'informational'

export type CheckCategory =
  'completeness' | 'schema' | 'formula' | 'stale-result' | 'required-link'

export type CheckRuleType =
  | 'completeness-title'
  | 'min-count'
  | 'schema-valid-columns'
  | 'formula-supported'
  | 'formula-no-stale'
  | 'required-links'

export interface CheckRule {
  type: CheckRuleType
  path?: string
  minCount?: number
  linkTypes?: string[]
}

export interface CheckDefinitionItem {
  key: string
  category: CheckCategory
  severity: CheckSeverity
  label: string
  rule: CheckRule
}

export interface CheckDefinition {
  checks: CheckDefinitionItem[]
}

// ---------------------------------------------------------------------------
// Check result shapes (immutable evidence produced by the RPC).
// ---------------------------------------------------------------------------

export type CheckItemStatus = 'pass' | 'fail'

export interface CheckItemResult {
  key: string
  category: CheckCategory
  severity: CheckSeverity
  label: string
  status: CheckItemStatus
  evidence: Record<string, unknown>
}

export type OverallCheckStatus = 'pass' | 'warning' | 'fail'

/** Result returned by the `run_revision_checks` RPC. */
export interface RunRevisionChecksResult {
  id: string
  revisionId: string
  checkDefinitionKey: string
  checkDefinitionVersion: number
  revisionIntegrityDigest: string
  checkDefinitionDigest: string
  inputDigest: string
  overallStatus: OverallCheckStatus
  passCount: number
  blockingFailureCount: number
  warningFailureCount: number
  infoFailureCount: number
  results: CheckItemResult[]
  runAt: string
  idempotent: boolean
}

/** Wire shape from the `review_check_results` REST resource (snake_case). */
export interface ReviewCheckResultWire {
  id: string
  workspace_id: string
  record_id: string
  revision_id: string
  check_definition_key: string
  check_definition_version: number
  revision_integrity_digest: string
  check_definition_digest: string
  input_digest: string
  overall_status: OverallCheckStatus
  pass_count: number
  blocking_failure_count: number
  warning_failure_count: number
  info_failure_count: number
  results: CheckItemResult[]
  run_by_user_id: string
  run_session_id: string
  run_role: string
  run_at: string
  idempotency_key: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Query keys.
// ---------------------------------------------------------------------------

export const reviewCheckQueryKeys = {
  resultsForRevision: (revisionId: string) =>
    ['review-checks', 'revision', revisionId] as const,
  result: (resultId: string) => ['review-checks', 'result', resultId] as const,
  resultsForRecord: (recordId: string) =>
    ['review-checks', 'record', recordId] as const,
}

// ---------------------------------------------------------------------------
// RPC and data functions.
// ---------------------------------------------------------------------------

export interface RunRevisionChecksInput {
  revisionId: string
  checkDefinitionKey: string
  checkDefinitionVersion: number
  idempotencyKey: string
}

/**
 * Run all checks from a versioned check definition against a frozen revision's
 * canonical snapshot. The RPC reads exclusively from the immutable revision —
 * live data changes cannot affect the result.
 */
export function runRevisionChecks(
  client: DataClient,
  input: RunRevisionChecksInput,
): Promise<RunRevisionChecksResult> {
  return client.rpc('run_revision_checks', {
    p_revision_id: input.revisionId,
    p_check_definition_key: input.checkDefinitionKey,
    p_check_definition_version: input.checkDefinitionVersion,
    p_confirmed: true,
    p_idempotency_key: input.idempotencyKey,
  })
}

/** Fetch all immutable check results for a revision. */
export function fetchReviewCheckResults(
  client: DataClient,
  revisionId: string,
): Promise<ReviewCheckResultWire[]> {
  return client.list<ReviewCheckResultWire>(
    'review_check_results',
    `?revision_id=eq.${revisionId}&order=run_at.desc`,
  )
}

/** Fetch a single immutable check result by id. */
export function fetchReviewCheckResult(
  client: DataClient,
  resultId: string,
): Promise<ReviewCheckResultWire | null> {
  return client
    .list<ReviewCheckResultWire>(
      'review_check_results',
      `?id=eq.${resultId}&limit=1`,
    )
    .then((rows) => (rows.length > 0 ? rows[0] : null))
}
