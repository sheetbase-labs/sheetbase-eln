import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'
import { t } from '#/copy'

/**
 * What a list shows when its data did not load. A failed read is not an empty
 * list: this takes the empty state's place so nobody reads "0 experiments" as
 * an empty lab, and offers the one next step, a retry.
 */
export function ListLoadError({
  list,
  onRetry,
  retrying = false,
}: {
  /** What did not load, lower case, e.g. "experiments". */
  list: string
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <div role="alert" data-testid="list-load-error">
      <EmptyState
        icon="warn"
        title={t('common.errors.listLoadFailedTitle', { list })}
        description={t('common.errors.listLoadFailedBody')}
        action={
          <Button onClick={onRetry} disabled={retrying}>
            {retrying
              ? t('common.states.retrying')
              : t('common.actions.tryAgain')}
          </Button>
        }
      />
    </div>
  )
}
