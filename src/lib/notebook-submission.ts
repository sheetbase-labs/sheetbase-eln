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
import type { NotebookBlock } from '#/lib/notebook-data'
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
  /** Verified digest from `preview_submission_digest`, when it succeeded. */
  digest: string | null
  digestPending: boolean
  digestError: string | null
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
  return [
    {
      id: 'unsaved-drafts',
      label: 'No unsaved drafts',
      state: input.hasUnsavedWork ? 'fail' : 'pass',
      detail: input.hasUnsavedWork
        ? 'Blocks with unsaved drafts are not part of the server snapshot — save or discard them before submitting.'
        : 'Every block edit is saved to the server.',
    },
    {
      id: 'notebook-state',
      label: 'Notebook is working, not archived or already submitted',
      state: submittableState ? 'pass' : 'fail',
      detail: submittableState
        ? 'The server re-checks this state when the snapshot is verified and again on submit.'
        : 'Archived, locked and in-review Notebooks cannot be submitted. The server rejects the submission regardless of this dialog.',
    },
    {
      id: 'snapshot-digest',
      label: 'Snapshot verified against the server',
      state: input.digest
        ? 'pass'
        : input.digestPending
          ? 'pending'
          : input.digestError
            ? 'fail'
            : 'pending',
      detail: input.digest
        ? 'The digest pins the exact content that will be frozen. If the Notebook changes before you confirm, the server rejects the stale digest.'
        : input.digestPending
          ? 'Verifying the snapshot with the server…'
          : (input.digestError ??
            'Run “Check snapshot” to verify the digest of what will be frozen.'),
    },
    {
      id: 'reviewers',
      label: 'At least one reviewer assigned',
      state: input.reviewerCount > 0 ? 'pass' : 'fail',
      detail:
        input.reviewerCount > 0
          ? 'Reviewers are chosen from workspace members; the server rejects anyone outside the workspace.'
          : 'The server requires at least one assigned reviewer.',
    },
    {
      id: 'sheet-edits',
      label: 'Embedded Sheets checked for pending edits',
      state: 'manual',
      detail:
        'Sheet evidence is captured at submission time. This dialog cannot see pending cell edits inside a Sheet — confirm each Sheet is saved on the Sheet itself.',
    },
  ]
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
