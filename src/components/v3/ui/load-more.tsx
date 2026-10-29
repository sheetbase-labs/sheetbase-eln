import { Button } from './button'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/**
 * The control at the end of a growing-window list: a cursor page, a raised
 * `limit`, a continuation token.
 *
 * Six screens hand-rolled one of these with five labels between them
 * ("Loading…", "Loading more…", "Load more", "Load more (N left)", "Scroll for
 * older entries") and not one `nav` landmark, and the audit log's tail offered
 * no control at all below the scroll trigger — a keyboard user could not reach
 * the rest of the log. One control: one label, one count format, one retry, and
 * a landmark that says what is being extended.
 *
 * The state a screen is in is the caller's (`hasMore`, `loading`, `error`); the
 * count line is optional, because screens that already print it (the dataset
 * rows grid, the audit log's toolbar) pass none.
 */
export function LoadMore({
  label,
  hasMore,
  loading = false,
  error,
  onLoadMore,
  loaded,
  total,
  noun,
  endLabel,
  className,
}: {
  /** Accessible name for the landmark, e.g. "Search results". */
  label: string
  hasMore: boolean
  loading?: boolean
  /**
   * What to say when the last read failed. Given, the control becomes the
   * retry; the screen supplies the words, because it is the screen that knows
   * what failed.
   */
  error?: React.ReactNode
  onLoadMore: () => void
  /** Rows read so far and the whole count, when the screen knows both. */
  loaded?: number
  total?: number
  /** What is counted, plural: "changes". */
  noun?: string
  /** What the tail says once there is nothing more to read. */
  endLabel?: React.ReactNode
  className?: string
}) {
  const counted = loaded != null && total != null
  const failed = error != null
  // Nothing to say and nothing to do: a screen that has read everything and
  // prints no end label keeps its own footer rather than an empty landmark.
  if (!failed && !hasMore && !counted && endLabel == null) return null
  return (
    <nav
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-3', className)}
    >
      {counted ? (
        <span className="num text-label text-fg-muted">
          {t('settings.uiKit.loadMore.showing', { loaded, total })}
          {noun ? ` ${noun}` : ''}
        </span>
      ) : null}
      {failed ? (
        <>
          <span role="alert" className="text-label text-danger-text">
            {error}
          </span>
          <Button size="sm" disabled={loading} onClick={onLoadMore}>
            {t('settings.uiKit.loadMore.retry')}
          </Button>
        </>
      ) : hasMore ? (
        <Button size="sm" disabled={loading} onClick={onLoadMore}>
          {loading
            ? t('common.states.loading')
            : t('settings.uiKit.loadMore.loadMore')}
        </Button>
      ) : endLabel != null ? (
        <span className="text-label text-fg-muted">{endLabel}</span>
      ) : null}
    </nav>
  )
}
