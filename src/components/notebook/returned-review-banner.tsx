import { t } from '#/copy'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
import {
  commentsQueryKeys,
  fetchCommentsForRevision,
  groupCommentsIntoThreads,
  threadState,
} from '#/lib/comments-data'
import { formatDate } from '#/lib/notebook-data'
import {
  fetchReviewDecisions,
  reviewWorkspaceQueryKeys,
} from '#/lib/review-workspace'
import { reviewsDataClient } from '#/lib/reviews'
import type { ReviewSubmissionWire } from '#/lib/reviews'
import { useUserNames } from '#/lib/user-names'

/**
 * A review that came back with changes, shown in the notebook where the changes
 * are made. The reviewer's comments live on the review page; this says who sent
 * the notebook back, how many comments are still open, what to do next, and
 * opens them.
 */
export function ReturnedReviewBanner({
  submission,
  currentUserId,
  currentUserName,
}: {
  submission: ReviewSubmissionWire
  currentUserId: string
  currentUserName: string
}) {
  const decisions = useQuery({
    queryKey: reviewWorkspaceQueryKeys.decisions(submission.id),
    queryFn: () => fetchReviewDecisions(reviewsDataClient, submission.id),
  })
  const comments = useQuery({
    queryKey: commentsQueryKeys.forRevision(submission.revision_id),
    queryFn: () =>
      fetchCommentsForRevision(reviewsDataClient, submission.revision_id),
  })
  const latestReturn =
    [...(decisions.data ?? [])]
      .reverse()
      .find((decision) => decision.decision === 'request_changes') ?? null
  const returnedBy = latestReturn?.actor_user_id ?? null
  const names = useUserNames(returnedBy ? [returnedBy] : [], {
    id: currentUserId,
    name: currentUserName,
  })
  const returnedByName = returnedBy
    ? (names.names[returnedBy] ?? t('notebook.returnedReviewBanner.aColleague'))
    : null
  const open = comments.data
    ? groupCommentsIntoThreads(comments.data).filter(
        (thread) => threadState(thread) === 'open',
      ).length
    : null

  return (
    <div
      role="status"
      aria-label={t('notebook.returnedReviewBanner.ariaLabel')}
      className="my-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning-border bg-warning-wash px-3 py-2 text-xs text-warning-text"
    >
      <Icon name="arrowLeft" size={14} aria-hidden />
      <span>
        <span className="font-semibold">
          {t('notebook.returnedReviewBanner.ariaLabel')}
        </span>
        {returnedByName
          ? ` ${t('notebook.returnedReviewBanner.byName', { name: returnedByName })}`
          : ''}
        {latestReturn ? ` · ${formatDate(latestReturn.created_at)}` : ''}
        {open === null
          ? ''
          : open === 0
            ? t('notebook.returnedReviewBanner.noOpenComments')
            : ` · ${t('notebook.returnedReviewBanner.openComments', { count: open })}`}
        . {t('notebook.returnedReviewBanner.makeChanges')}
      </span>
      <span className="flex-1" />
      <Button
        size="sm"
        variant="secondary"
        nativeButton={false}
        render={
          <Link
            to="/review/$revisionId"
            params={{ revisionId: submission.revision_id }}
            search={{ tab: 'comments' }}
          />
        }
      >
        {t('notebook.returnedReviewBanner.readTheComments')}
      </Button>
    </div>
  )
}
