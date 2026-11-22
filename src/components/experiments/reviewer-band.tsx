import { Link } from '@tanstack/react-router'

import { Icon } from '#/components/icons'
import { formatDate } from '#/lib/notebook-data'
import { t } from '#/copy'

/**
 * Tells the assigned reviewer, on the experiment itself, that it is waiting
 * for them and which version they are reading. Approve and Request changes
 * are in the header beside it.
 */
export function ReviewerBand({
  ownerName,
  submittedAt,
  revisionId,
  waitingFor,
}: {
  ownerName: string
  submittedAt?: string
  revisionId?: string
  /** Set on the author's own page: who the review is waiting for. */
  waitingFor?: string
}) {
  return (
    <div
      role="status"
      data-reviewer-band
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-muted px-4 py-2 text-label text-fg-muted md:px-6"
    >
      <Icon name="info" size={14} className="shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 basis-64 max-md:basis-0">
        <strong className="font-medium text-fg">
          {waitingFor
            ? t('projects.experimentPage.reviewBand.authorTitle', {
                reviewers: waitingFor,
              })
            : t('projects.experimentPage.reviewBand.title')}
        </strong>{' '}
        {/* The sentence under the title is for a wide screen: on a phone the
            band is the title and the link, one line instead of three. */}
        <span className="max-md:hidden">
          {waitingFor
            ? t('projects.experimentPage.reviewBand.authorBody', {
                date: submittedAt ? formatDate(submittedAt) : '',
              })
            : t('projects.experimentPage.reviewBand.body', {
                name: ownerName,
                date: submittedAt ? formatDate(submittedAt) : '',
              })}
        </span>
      </p>
      {revisionId ? (
        <Link
          to="/review/$revisionId"
          params={{ revisionId }}
          className="shrink-0 text-link"
        >
          {t('projects.experimentPage.reviewBand.open')}
        </Link>
      ) : null}
    </div>
  )
}

/**
 * The band an experiment shows while it is in review: to the reviewer, that it
 * is waiting for them; to the author, who it is waiting for.
 */
export function ReviewStatusBand({
  reviewing,
  inReview,
  ownerName,
  submittedAt,
  revisionId,
  waitingNames,
}: {
  reviewing: boolean
  inReview: boolean
  ownerName: string
  submittedAt?: string
  revisionId?: string
  waitingNames: readonly string[]
}) {
  if (reviewing) {
    return (
      <ReviewerBand
        ownerName={ownerName}
        submittedAt={submittedAt}
        revisionId={revisionId}
      />
    )
  }

  if (!inReview || waitingNames.length === 0) return null

  return (
    <ReviewerBand
      ownerName={ownerName}
      submittedAt={submittedAt}
      revisionId={revisionId}
      waitingFor={waitingNames.join(', ')}
    />
  )
}
