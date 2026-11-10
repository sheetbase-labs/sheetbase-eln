/** Focus a document location, scrolling only when the runtime supports it. */
export function focusChange(target: HTMLElement | undefined) {
  if (!target) return
  target.focus()
  // oxlint-disable-next-line typescript/unbound-method -- Approved once-only capability capture; the guarded call below explicitly supplies this target as receiver.
  const scrollIntoView = target.scrollIntoView

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Approved native DOM capability: jsdom may omit scrolling; capture once after focus and call with the element receiver.
  if (typeof scrollIntoView === 'function') {
    scrollIntoView.call(target, { behavior: 'auto', block: 'nearest' })
  }
}
