/**
 * ASSIST-03 — submission-readiness guide mount for the submit dialog.
 *
 * Derives guide state from the same canonical inputs the NOTE-04 readiness
 * checklist uses (unsaved-work signal, lifecycle state, reviewer selection,
 * verified digest) and wires next actions to the dialog's own canonical
 * mutations: the snapshot accept runs the same check the dialog's
 * “Check snapshot” button runs, and the submit accept runs the same guarded
 * submit the dialog confirms. Review-decision accepts belong to the review
 * workspace, so they navigate there. The wrapper never mutates anything
 * itself.
 */
import { evaluateSubmissionReadiness } from '#/lib/assist-guide'
import type { GuideAcceptKey } from '#/lib/assist-guide'

import { GuidePanel } from './guide-panel'

export interface SubmissionReadinessGuideProps {
  recordId: string
  hasUnsavedWork: boolean
  archivedAt: string | null
  lockedAt: string | null
  activeReview: boolean
  reviewerCount: number
  digest: string | null
  digestPending: boolean
  digestError: string | null
  onCheckSnapshot?: () => void
  onSubmitRevision?: () => void
  onOpenReviews?: () => void
}

export function SubmissionReadinessGuide({
  recordId,
  hasUnsavedWork,
  archivedAt,
  lockedAt,
  activeReview,
  reviewerCount,
  digest,
  digestPending,
  digestError,
  onCheckSnapshot,
  onSubmitRevision,
  onOpenReviews,
}: SubmissionReadinessGuideProps) {
  // The dialog is the pre-submit surface: no submission or decision exists
  // yet, so the review step stays blocked on 'Submitted' until the dialog's
  // own submit succeeds (which navigates to the review workspace).
  const workflow = evaluateSubmissionReadiness({
    recordId,
    hasUnsavedWork,
    archivedAt,
    lockedAt,
    activeReview,
    reviewerCount,
    digest,
    digestPending,
    digestError,
    submissionId: null,
    decision: null,
  })

  function handleAccept(key: GuideAcceptKey) {
    if (key === 'previewSubmissionDigest') {
      onCheckSnapshot?.()
      return
    }
    if (key === 'submitRecordRevision') {
      onSubmitRevision?.()
      return
    }
    // Review decisions belong to the review workspace, not the submit
    // dialog: navigate there. Guidance only navigates — nothing is changed.
    onOpenReviews?.()
  }

  return <GuidePanel workflow={workflow} onAccept={handleAccept} />
}
