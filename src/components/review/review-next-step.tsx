import { Link } from '@tanstack/react-router'

import { Notice } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { nextReviewItem } from '#/lib/review-next-step'
import { reviewsDataClient } from '#/lib/reviews'
import type { ReviewNextStep } from '#/lib/review-next-step'
import { itemLink } from '#/lib/work-items/destination'
import { useWorkItems } from '#/lib/work-items/data'
import { t } from '#/copy'

/**
 * What happens next on this review, and the next review waiting on the reader.
 * The wording comes from `reviewNextStep`; the next review comes from the same
 * Inbox read, so Next review opens exactly what the Inbox would list first.
 */
export function ReviewNextStepPanel({
  step,
  currentRevisionId,
  action,
}: {
  step: ReviewNextStep
  currentRevisionId: string
  /** The one thing the reader can do about it right now, e.g. Sign now. */
  action?: { label: string; onClick: () => void }
}) {
  const work = useWorkItems(reviewsDataClient)
  const next = work.data ? nextReviewItem(work.data, currentRevisionId) : null

  return (
    <Notice
      role="region"
      aria-label={t('projects.nextStep.label')}
      icon="info"
      title={step.headline}
      action={
        action || next || work.isSuccess ? (
          <div className="flex flex-wrap items-center gap-2">
            {action ? (
              <Button size="sm" onClick={action.onClick}>
                {action.label}
              </Button>
            ) : null}
            {next ? (
              <Button
                size="sm"
                variant="secondary"
                nativeButton={false}
                render={<Link {...itemLink(next)} />}
              >
                {t('projects.nextStep.next', {
                  name: next.identifier ?? next.title,
                })}
              </Button>
            ) : work.isSuccess ? (
              <span className="text-fg-muted">
                {t('projects.nextStep.none')}
              </span>
            ) : null}
          </div>
        ) : null
      }
    >
      {step.detail}
    </Notice>
  )
}
