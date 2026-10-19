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
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}

export function reviewNextStep(input: ReviewNextStepInput): ReviewNextStep {
  const reviewers = names(input.reviewerNames, 'the assigned reviewers')
  const submitter = input.submitterName ?? 'The author'
  if (input.superseded) {
    return {
      headline: 'Replaced by a newer revision',
      detail:
        'This revision stays readable as history. Nothing is waiting on it; the newer revision carries the review.',
    }
  }
  if (input.locked && input.state === 'approved') {
    return {
      headline: 'Signed and locked',
      detail:
        'The evidence is frozen. To change the record, amend it; the amendment starts a new review.',
    }
  }
  switch (input.state) {
    case 'submitted':
      if (input.isAssignedReviewer) {
        return {
          headline: 'Waiting for your decision',
          detail:
            'Approve to go on to signing, request changes to send it back with your comments, or reject to close it. The author is notified of whichever you choose.',
        }
      }
      if (input.isSubmitter) {
        return {
          headline: `Waiting for ${reviewers}`,
          detail:
            'You will get an Inbox item when they decide. Until then the notebook is frozen; withdraw it from the notebook menu to change your mind.',
        }
      }
      return {
        headline: `Waiting for ${reviewers}`,
        detail:
          'The reviewers have been asked. You can read the changes and the comments here.',
      }
    case 'returned':
      return input.isSubmitter
        ? {
            headline: 'Returned for changes',
            detail:
              'Open the notebook, make the changes the comments ask for, then submit it again. The reviewers are asked again when you do.',
          }
        : {
            headline: 'Returned for changes',
            detail: `${submitter} edits the notebook and submits it again. ${reviewers} are asked to review again when that happens.`,
          }
    case 'rejected':
      return {
        headline: 'Rejected',
        detail:
          'This review is closed and cannot be reopened. A new revision has to be submitted if the work should be reviewed again.',
      }
    case 'withdrawn':
      return {
        headline: 'Withdrawn',
        detail:
          'The author took this back out of review. Nothing is waiting on you; if they submit again you will be asked then.',
      }
    case 'approved':
      if (input.isAssignedReviewer && !input.hasSigned) {
        return {
          headline: 'Approved, waiting for your signature',
          detail:
            'Sign to lock the record. Until you sign the evidence stays open; choose Sign later and it waits in your Inbox.',
        }
      }
      return {
        headline: 'Approved, waiting for signatures',
        detail: `The record locks when the required signatures are in. ${reviewers} still need to sign; the author is told when it is locked.`,
      }
    default:
      return {
        headline: 'Not submitted for review',
        detail:
          'This revision has no review. Submit the notebook from its page to ask for one.',
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
