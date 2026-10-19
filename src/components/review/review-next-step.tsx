import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { nextReviewItem } from '#/lib/review-next-step'
import { reviewsDataClient } from '#/lib/reviews'
import type { ReviewNextStep } from '#/lib/review-next-step'
import { itemLink } from '#/lib/work-items/destination'
import { useWorkItems } from '#/lib/work-items/data'

/**
 * What happens next on this review, and the next review waiting on the reader.
 * The wording comes from `reviewNextStep`; the next review comes from the same
 * Inbox read, so Next review opens exactly what the Inbox would list first.
 */
export function ReviewNextStepPanel({
  step,
  currentRevisionId,
}: {
  step: ReviewNextStep
  currentRevisionId: string
}) {
  const work = useWorkItems(reviewsDataClient)
  const next = work.data ? nextReviewItem(work.data, currentRevisionId) : null
  return (
    <section
      aria-label="What happens next"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs"
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 font-semibold text-foreground">{step.headline}</p>
        <p className="m-0 mt-0.5 text-fg-muted">{step.detail}</p>
      </div>
      {next ? (
        <Button
          size="sm"
          variant="secondary"
          nativeButton={false}
          render={<Link {...itemLink(next)} />}
        >
          Next review: {next.identifier ?? next.title}
        </Button>
      ) : work.isSuccess ? (
        <span className="text-fg-muted">No other reviews waiting for you.</span>
      ) : null}
    </section>
  )
}
