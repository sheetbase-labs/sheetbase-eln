import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Notice } from '#/components/v3/ui/alert'
import { Skeleton } from '#/components/v3/ui/skeleton'

/**
 * Column chrome that is deliberately *not* part of what is being compared.
 *
 * Empty, loading and error are screen states rather than component states: the
 * notebook's list and ReUI's `Sortable` both render none of them. Supplying one
 * shared version is what keeps the fixture and the conditions identical on both
 * sides — and the comparison record states that these rows therefore measure the
 * column's containment and keyboard order, not the component's own rendering.
 *
 * The restricted state is different: what a disabled control looks like is the
 * component's own business, so each column renders its own and only the reason
 * is shared.
 */

/** 0-row fixture: the empty state, not an error. */
export function ComparisonEmptyState() {
  return (
    <EmptyState
      icon="table"
      title="No rows"
      body="This fixture has no rows. The column must say so and keep its controls reachable."
    />
  )
}

/** Loading: the column keeps its shape and announces that it is busy. */
export function ComparisonLoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div
      className="flex flex-col gap-1"
      aria-busy="true"
      data-comparison-state="loading"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
        >
          <Skeleton className="size-4" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

/**
 * Error: report the failure and offer the retry the real screen would offer.
 * The retry is real here — it returns the harness to the ready state — because
 * a retry that does nothing cannot be checked with a keyboard.
 */
export function ComparisonErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Notice
      tone="bad"
      title="The rows could not be loaded"
      action={
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      The fixture could not be rendered. This is the harness's own error state;
      both columns show it.
    </Notice>
  )
}

/** Permission-restricted: the reason, in text, not in a tooltip. */
export function ComparisonRestrictedNotice() {
  return (
    <Notice tone="warn" icon="lock" title="View only">
      Reordering and editing need editor access on this workspace.
    </Notice>
  )
}
