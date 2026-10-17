import { useEffect, useRef, useState } from 'react'

/**
 * How long a search box waits after the last keystroke before it tells the
 * route. The field keeps the typed text itself, so a burst faster than a
 * router round-trip — a hardware barcode scanner, or a paste — is never
 * rendered back from stale state.
 */
export const SEARCH_SETTLE_MS = 200

/**
 * A text field's value: what was typed, and what it settled to.
 *
 * The box holds the immediate text — rendering it straight from the route's
 * parameter lost characters, because each keystroke navigated and a re-render
 * with the still-stale parameter wrote an older value back into the field
 * before the router had caught up — and reports the text once it has been still
 * for `ms`, either through `onSettle` or in `settled`.
 *
 * The second half is the part a bare `setTimeout` gets wrong: a value that
 * arrives from somewhere else (another tab, "Clear search", a deep link) is
 * adopted, and anything still queued from typing is dropped rather than
 * clobbering what the screen now shows. `sent` is what tells the echo of this
 * box's own report apart from a change made elsewhere.
 *
 * The three copies of this rule (the registry toolbar, the dataset rows grid,
 * the audit log) differ only in their delay and their transport: 200 ms to a
 * route, 250 ms to a server read.
 */
export function useSettledValue(
  value: string,
  ms: number,
  onSettle?: (next: string) => void,
): {
  /** What the field shows. */
  value: string
  /** The field's change handler, which settles before it reports. */
  setValue: (next: string) => void
  /** The value after it has been still for `ms`. */
  settled: string
} {
  const [text, setText] = useState(value)
  const [settled, setSettled] = useState(value)
  const sent = useRef(value)
  const timer = useRef<number | null>(null)
  const settle = useRef(onSettle)
  settle.current = onSettle

  useEffect(() => {
    if (value === sent.current) return
    clearTimeout(timer.current ?? undefined)
    timer.current = null
    sent.current = value
    setText(value)
    setSettled(value)
  }, [value])

  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  const setValue = (next: string) => {
    setText(next)
    clearTimeout(timer.current ?? undefined)
    timer.current = window.setTimeout(() => {
      timer.current = null
      sent.current = next
      setSettled(next)
      settle.current?.(next)
    }, ms)
  }

  return { value: text, setValue, settled }
}
