'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Controls a page lends to the header of the pane it sits in: a record's
 * Follow bell, which belongs with the pane's own link, pin and close rather
 * than among the record's actions. Outside a pane (or before one is found)
 * the `fallback` renders where the slot stands, so the control is never lost.
 *
 * The pane header keeps an empty `[data-pane-page-actions]` span for this; the
 * slot looks for it in its own pane only, so two record panes side by side
 * each fill their own header.
 */
export function PaneHeaderSlot({
  children,
  fallback = null,
}: {
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const pane = anchor.current?.closest<HTMLElement>('[data-workspace-pane]')

    setTarget(
      pane?.querySelector<HTMLElement>('[data-pane-page-actions]') ?? null,
    )
  }, [])

  return (
    <>
      <span ref={anchor} hidden data-pane-header-slot />
      {target ? createPortal(children, target) : fallback}
    </>
  )
}
