/**
 * NOTE-04 — pre-submission readiness derivations.
 *
 * Pure client-side derivations from canonical state that help a scientist
 * understand what submitting will do before they confirm. The server remains
 * the authority: `preview_submission_digest` verifies the snapshot and
 * `submit_record_revision` enforces every transition guard. Nothing here
 * invents validation rules the server does not have — checks the browser
 * cannot evaluate (e.g. pending Sheet write-back, which lives inside the
 * Sheet workspace's own state) are surfaced as manual checks that point at
 * the authoritative surface instead of a fabricated pass/fail.
 *
 * A preview is not evidence: these derivations never mutate data and never
 * create revisions.
 */
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import { isCanonicalSheetBlock, sheetBlockInstanceId } from '#/lib/sheet-block'

export type SubmissionCheckState = 'pass' | 'fail' | 'pending' | 'manual'

export interface SubmissionCheck {
  id: string
  label: string
  state: SubmissionCheckState
  detail: string
}

export interface SubmissionReadinessInput {
  /** NotebookDocument's document-level unsaved-work signal. */
  hasUnsavedWork: boolean
  archivedAt: string | null
  lockedAt: string | null
  /** An active review submission exists (`notebookReviewActivity !== 'none'`). */
  activeReview: boolean
  /** Number of reviewers currently selected in the dialog. */
  reviewerCount: number
  /** Reviewers the workspace asks for on every submission (default one). */
  minReviewers?: number
  /** Verified digest from `preview_submission_digest`, when it succeeded. */
  digest: string | null
  digestPending: boolean
  digestError: string | null
  /** Embedded sheets in the notebook; they add a manual "saved" check. */
  sheetCount?: number
}

/**
 * Readiness checklist for the submit dialog. The digest check re-evaluates
 * the canonical state server-side; the state checks mirror the guards the
 * submit RPC enforces (archived/deleted records fail closed, one reviewer
 * required) so the user sees the same wall before they hit it.
 */
export function submissionReadinessChecks(
  input: SubmissionReadinessInput,
): SubmissionCheck[] {
  const submittableState =
    !input.archivedAt && !input.lockedAt && !input.activeReview
  const minReviewers = Math.max(1, input.minReviewers ?? 1)
  const checks: SubmissionCheck[] = [
    {
      id: 'unsaved-drafts',
      label: 'Everything is saved',
      state: input.hasUnsavedWork ? 'fail' : 'pass',
      detail: input.hasUnsavedWork
        ? 'Some blocks have changes that are not saved yet. Save or discard them before you submit.'
        : 'Every change is saved.',
    },
    {
      id: 'notebook-state',
      label: 'Notebook can be submitted',
      state: submittableState ? 'pass' : 'fail',
      detail: submittableState
        ? 'This notebook is open for submitting.'
        : 'A notebook that is archived, locked or already in review can’t be submitted.',
    },
    {
      id: 'snapshot-digest',
      label: 'Notebook checked',
      state: input.digest ? 'pass' : input.digestError ? 'fail' : 'pending',
      detail: input.digest
        ? 'The content that will be sent for review has been checked.'
        : input.digestPending
          ? 'Checking your notebook…'
          : (input.digestError ?? 'Checking your notebook…'),
    },
    {
      id: 'reviewers',
      label:
        minReviewers === 1
          ? 'A reviewer is chosen'
          : `At least ${minReviewers} reviewers are chosen`,
      state: input.reviewerCount >= minReviewers ? 'pass' : 'fail',
      detail:
        input.reviewerCount >= minReviewers
          ? 'Reviewers will be asked as soon as you submit.'
          : minReviewers === 1
            ? 'Choose someone to review this notebook.'
            : `Your workspace asks for at least ${minReviewers} reviewers on every submission.`,
    },
  ]
  if ((input.sheetCount ?? 0) > 0)
    checks.push({
      id: 'sheet-edits',
      label: 'Sheets are saved',
      state: 'manual',
      detail:
        'Open each sheet and make sure its latest cell edits are saved. This dialog can’t see edits inside a sheet.',
    })
  return checks
}

/** True when any check should block the confirm button. */
export function submissionHasBlockingChecks(
  checks: SubmissionCheck[],
): boolean {
  return checks.some((check) => check.state === 'fail')
}

/** Sheet Instance ids embedded in the record, in document order. */
export function submissionSheetInstanceIds(blocks: NotebookBlock[]): string[] {
  const ids: string[] = []
  for (const block of blocks) {
    if (block.type !== 'sheet' && block.type !== 'sheet_shared') continue
    if (!isCanonicalSheetBlock(block.payload)) continue
    const id = sheetBlockInstanceId(block.payload)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** Compact, honest composition summary of what submission would freeze. */
export function submissionCompositionSummary(blocks: NotebookBlock[]): {
  blockCount: number
  sheetCount: number
} {
  return {
    blockCount: blocks.length,
    sheetCount: submissionSheetInstanceIds(blocks).length,
  }
}

// ---------------------------------------------------------------------------
// NOTE-04 review fix: canonical signature for the verified-snapshot binding.
// ---------------------------------------------------------------------------

/** Key-stable JSON serialisation so payloads compare regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  )
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`
}

/** Compact FNV-1a hash — change detection only, not cryptographic. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

export interface SubmissionCanonicalInput {
  /** The live record from the route's query cache, when loaded. */
  record: NotebookRecord | null
  /** The live blocks in cache order. */
  blocks: NotebookBlock[]
}

/**
 * Lightweight signature over the same canonical signals the server digest
 * covers: record metadata (title/status/tags/properties and the structure and
 * metadata versions) plus every block's id, placement, version and payload.
 * Used client-side to bind the dialog's frozen preview to the verified
 * digest and invalidate it the moment any input changes. When a signal
 * cannot be observed here (e.g. pending Sheet edits, surfaced as a manual
 * check instead), the signature deliberately says nothing about it.
 */
export function submissionCanonicalSignature(
  input: SubmissionCanonicalInput,
): string {
  const { record, blocks } = input
  const blockPart = [...blocks]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(
      (block) =>
        `${block.id}:${block.type}:${block.order}:${block.version}:${block.payloadSchemaVersion}:${fnv1a(stableStringify(block.payload))}`,
    )
    .join(',')
  const recordPart = record
    ? [
        record.id,
        record.title,
        record.status,
        String(record.structureVersion),
        String(record.metadataVersion),
        record.updatedAt,
        String(record.lockedAt),
        String(record.archivedAt),
        stableStringify(record.tags),
        stableStringify(record.properties),
      ].join('|')
    : 'no-record'
  return `${recordPart}#${blockPart}`
}
