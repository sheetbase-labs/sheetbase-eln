import { useEffect, useRef } from 'react'

import { Button } from './button'
import { cn } from '#/lib/utils'
import { t } from '#/copy'

/** How far before the end of the list the next page starts to load, so a
 * reader scrolling at speed rarely reaches the bottom. */
const PRELOAD_MARGIN_PX = 480

/**
 * The tail of a growing-window list: a cursor page, a raised `limit`, a
 * continuation token. The next page loads by itself as the tail scrolls into
 * view, so a reader never has to count what is loaded or ask for more.
 *
 * The control only shows something when it is working or has failed: a quiet
 * "Loading…" while a page is read, and the error with a retry when it was not.
 * Where the browser cannot watch for the tail (no `IntersectionObserver`) a
 * "Load more" button stands in.
 *
 * The state a screen is in is the caller's (`hasMore`, `loading`, `error`).
 */
export function LoadMore({
  label,
  hasMore,
  loading = false,
  error,
  onLoadMore,
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
  className?: string
}) {
  const failed = error != null
  const tail = useRef<HTMLDivElement>(null)
  const canWatch = typeof IntersectionObserver !== 'undefined'
  const onLoadMoreRef = useRef(onLoadMore)

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  })

  // Watch again after every page: a short page can leave the tail still in
  // view, and a fresh observer reports that straight away.
  useEffect(() => {
    const el = tail.current

    if (!el || !canWatch || !hasMore || loading || failed) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          onLoadMoreRef.current()
      },
      { rootMargin: `0px 0px ${PRELOAD_MARGIN_PX}px 0px` },
    )

    observer.observe(el)

    return () => observer.disconnect()
  }, [canWatch, hasMore, loading, failed])

  if (!failed && !hasMore) return null

  return (
    <nav
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-3', className)}
    >
      {failed ? (
        <>
          <span role="alert" className="text-label text-danger-text">
            {error}
          </span>
          <Button size="sm" disabled={loading} onClick={onLoadMore}>
            {t('common.actions.tryAgain')}
          </Button>
        </>
      ) : canWatch ? (
        <div ref={tail} className="min-h-6 text-label text-fg-muted">
          {loading ? t('common.states.loading') : null}
        </div>
      ) : (
        <Button size="sm" disabled={loading} onClick={onLoadMore}>
          {loading
            ? t('common.states.loading')
            : t('settings.uiKit.loadMore.loadMore')}
        </Button>
      )}
    </nav>
  )
}
