import { t } from '#/copy'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import {
  ConfirmDialog,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { Button } from '#/components/v3/ui/button'
import { Textarea } from '#/components/v3/inventory/list'
import { notebookQueryKeysAfterSignature } from '#/lib/notebook-experience'
import {
  DECISION_CONSEQUENCE,
  fetchRevisionRow,
  withdrawReview,
} from '#/lib/review-workspace'
import { reviewsDataClient } from '#/lib/reviews'
import type { ReviewSubmissionWire } from '#/lib/reviews'

/**
 * Take a notebook back out of review from the notebook itself. The submitter
 * does not have to open the review page to change their mind: the same
 * `withdraw_review` decision runs, against the digest of the revision under
 * review, and the notebook becomes editable again.
 */
export function WithdrawReviewDialog({
  open,
  onOpenChange,
  submission,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  submission: ReviewSubmissionWire
}) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const revision = await fetchRevisionRow(
        reviewsDataClient,
        submission.revision_id,
      )
      if (!revision?.integrity_digest) {
        throw new Error(
          t('notebook.withdrawReviewDialog.theRevisionUnderReview'),
        )
      }
      await withdrawReview(reviewsDataClient, {
        submissionId: submission.id,
        note: note.trim() || undefined,
        expectedRevisionDigest: revision.integrity_digest,
      })
      await Promise.all(
        notebookQueryKeysAfterSignature({
          recordId: submission.record_id,
          submissionId: submission.id,
          revisionId: submission.revision_id,
        }).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      )
      await queryClient.invalidateQueries({ queryKey: ['work-items'] })
      setNote('')
      onOpenChange(false)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t('notebook.withdrawReviewDialog.theWithdrawalFailed'),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next)
      }}
    >
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>
            {t('notebook.withdrawReviewDialog.withdrawThisNotebookFrom')}
          </ConfirmDialogTitle>
          <ConfirmDialogDescription>
            {t('notebook.withdrawReviewDialog.withdrawReviewersWhoWere', {
              withdraw: DECISION_CONSEQUENCE.withdraw,
            })}
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <Textarea
          className="min-h-[70px]"
          placeholder={t('notebook.withdrawReviewDialog.placeholder')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label={t('notebook.withdrawReviewDialog.ariaLabel')}
        />
        {error ? (
          <p role="alert" className="m-0 text-label text-danger-text">
            {error}
          </p>
        ) : null}
        <ConfirmDialogFooter>
          <ConfirmDialogCancel disabled={pending}>
            {t('notebook.withdrawReviewDialog.keepInReview')}
          </ConfirmDialogCancel>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending
              ? t('notebook.withdrawReviewDialog.withdrawing')
              : t('notebook.withdrawReviewDialog.withdraw')}
          </Button>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  )
}
