/**
 * What happens next on a review, stated for the person reading it.
 *
 * The review page used to show a state badge and leave the reader to work out
 * what that meant for them. Each state now says what is waiting, on whom, and
 * what this person can do about it, from the same authoritative fields the
 * lifecycle uses (`review_submissions.state`, the record's lock and the
 * revision's supersession). It is wording only: it invents no state and
 * enables nothing; the action buttons and the server stay the authority.
 */
import { t } from '#/copy'
import type { WorkItem } from './work-items/data'

export interface ReviewNextStepInput {
  /** `review_submissions.state`, or null when the revision was never submitted. */
  state: string | null
  /** A later revision replaced this one. */
  superseded: boolean
  /** The record is locked by a signature. */
  locked: boolean
  isSubmitter: boolean
  isAssignedReviewer: boolean
  /** The reader has already signed this submission. */
  hasSigned: boolean
  /** Names of the assigned reviewers other than the reader. */
  reviewerNames: readonly string[]
  submitterName: string | null
}

export interface ReviewNextStep {
  /** A short heading naming the situation. */
  headline: string
  /** What happens next, for this reader. */
  detail: string
}

function names(list: readonly string[], fallback: string): string {
  if (list.length === 0) return fallback
  if (list.length === 1) return list[0]
  return t('projects.reviewNextStep.listAnd', {
    list: list.slice(0, -1).join(', '),
    last: list.at(-1) ?? '',
  })
}

export function reviewNextStep(input: ReviewNextStepInput): ReviewNextStep {
  const reviewers = names(
    input.reviewerNames,
    t('projects.reviewNextStep.theAssignedReviewers'),
  )
  const submitter =
    input.submitterName ?? t('projects.reviewNextStep.theAuthor')
  if (input.superseded) {
    return {
      headline: t('projects.reviewNextStep.replacedByANewerRevision'),
      detail: t('projects.reviewNextStep.thisRevisionStaysReadableAs'),
    }
  }
  if (input.locked && input.state === 'approved') {
    return {
      headline: t('projects.reviewNextStep.signedAndLocked'),
      detail: t('projects.reviewNextStep.theEvidenceIsFrozenTo'),
    }
  }
  switch (input.state) {
    case 'submitted':
      if (input.isAssignedReviewer) {
        return {
          headline: t('projects.reviewNextStep.waitingForYourDecision'),
          detail: t('projects.reviewNextStep.approveToGoOnTo'),
        }
      }
      if (input.isSubmitter) {
        return {
          headline: t('projects.reviewNextStep.waitingFor', { reviewers }),
          detail: t('projects.reviewNextStep.youWillGetAnInbox'),
        }
      }
      return {
        headline: t('projects.reviewNextStep.waitingFor', { reviewers }),
        detail: t('projects.reviewNextStep.theReviewersHaveBeenAsked'),
      }
    case 'returned':
      return input.isSubmitter
        ? {
            headline: t('projects.reviewNextStep.returnedForChanges'),
            detail: t('projects.reviewNextStep.openTheNotebookMakeThe'),
          }
        : {
            headline: t('projects.reviewNextStep.returnedForChanges'),
            detail: t('projects.reviewNextStep.submitterEditsAgain', {
              submitter,
              reviewers,
            }),
          }
    case 'rejected':
      return {
        headline: t('projects.reviewNextStep.rejected'),
        detail: t('projects.reviewNextStep.thisReviewIsClosedAnd'),
      }
    case 'withdrawn':
      return {
        headline: t('projects.reviewNextStep.withdrawn'),
        detail: t('projects.reviewNextStep.theAuthorTookThisBack'),
      }
    case 'approved':
      if (input.isAssignedReviewer && !input.hasSigned) {
        return {
          headline: t(
            'projects.reviewNextStep.approvedWaitingForYourSignature',
          ),
          detail: t('projects.reviewNextStep.signToLockTheRecord'),
        }
      }
      return {
        headline: t('projects.reviewNextStep.approvedWaitingForSignatures'),
        detail: t('projects.reviewNextStep.recordLocksWhenSigned', {
          reviewers,
        }),
      }
    default:
      return {
        headline: t('projects.reviewNextStep.notSubmittedForReview'),
        detail: t('projects.reviewNextStep.thisRevisionHasNoReview'),
      }
  }
}

/**
 * The next review waiting on the reader after the one on screen: the first
 * review, signature or witness item in Inbox order that is not this revision.
 */
export function nextReviewItem(
  items: readonly WorkItem[],
  currentRevisionId: string,
): WorkItem | null {
  return (
    items.find(
      (item) =>
        (item.kind === 'review_requested' ||
          item.kind === 'approval_unsigned' ||
          item.kind === 'witness_requested') &&
        item.state !== 'following' &&
        item.revisionId != null &&
        item.revisionId !== currentRevisionId,
    ) ?? null
  )
}
