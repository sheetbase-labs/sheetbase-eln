/** How close to the bottom a scrolling pane must get before the next page is
 * asked for, in px. */
const NEAR_END_PX = 320

/**
 * Infinite scroll for a list that scrolls inside its own pane: the handler to
 * hang on the pane's `onScrollCapture`, which asks for the next page when the
 * pane that scrolled is near its end.
 *
 * Scroll events do not bubble, so the pane listens in the capture phase and
 * reads the element that scrolled. A failed page keeps its retry instead of
 * retrying on every scroll tick: pass `failed`.
 */
export function useScrollLoad({
  hasMore,
  loading,
  failed = false,
  onLoad,
}: {
  hasMore: boolean
  loading: boolean
  failed?: boolean
  onLoad: () => void
}) {
  return (event: React.UIEvent<HTMLElement>) => {
    if (!hasMore || loading || failed) return

    const el = event.target instanceof HTMLElement ? event.target : null

    if (!el) return

    if (el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_END_PX) return
    onLoad()
  }
}
