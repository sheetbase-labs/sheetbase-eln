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
}: {
  ownerName: string
  submittedAt?: string
  revisionId?: string
}) {
  return (
    <div
      role="status"
      data-reviewer-band
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-muted px-4 py-2 text-label text-fg-muted md:px-6"
    >
      <Icon name="info" size={14} className="shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 basis-64">
        <strong className="font-medium text-fg">
          {t('projects.experimentPage.reviewBand.title')}
        </strong>{' '}
        {t('projects.experimentPage.reviewBand.body', {
          name: ownerName,
          date: submittedAt ? formatDate(submittedAt) : '',
        })}
      </p>
      {revisionId ? (
        <Link
          to="/review/$revisionId"
          params={{ revisionId }}
          className="text-link"
        >
          {t('projects.experimentPage.reviewBand.open')}
        </Link>
      ) : null}
    </div>
  )
}
