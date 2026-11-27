import { useEffect, useRef, useState } from 'react'

import { Button } from './button'
import { Tooltip } from './tooltip'
import type { IconName } from '#/components/icons'
import { cn } from '#/lib/utils'

/**
 * A list row's quick actions, set at the end of a cell and shown while the
 * pointer is over the row or focus is inside it. Where a pointer can't hover
 * (a phone) they stay out of the way and the row opens as usual.
 */
export function RowHoverActions({
  children,
  actions,
  className,
}: {
  /** The cell's own content, which keeps its place. */
  children: React.ReactNode
  actions: React.ReactNode
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const active = useRowActive(ref)

  return (
    <span
      ref={ref}
      data-row-actions
      className={cn('flex min-h-6 min-w-0 items-center gap-2', className)}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {/* Only the row under the pointer or holding focus renders its
          actions, so a long list carries one set, not one per row, and a
          screen reader hears them only on the row it is in. */}
      {active ? (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- only stops the row's own click; the buttons inside are the interactive elements.
        <span
          className="flex shrink-0 animate-fade-in items-center gap-0.5 motion-reduce:animate-none"
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </span>
      ) : null}
    </span>
  )
}

/**
 * Whether the row around `ref` has a hovering pointer or focus inside it.
 * Hover counts only for a fine pointer, so a phone's tap never leaves a row's
 * actions showing.
 */
function useRowActive(ref: React.RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const row = ref.current?.closest('tr')

    if (!row) return
    let hovered = false
    let focused = false
    const update = () => setActive(hovered || focused)

    const enter = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return
      hovered = true
      update()
    }

    const leave = () => {
      hovered = false
      update()
    }

    const focusIn = () => {
      focused = true
      update()
    }

    const focusOut = (event: FocusEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        row.contains(event.relatedTarget)
      )
        return
      focused = false
      update()
    }

    row.addEventListener('pointerenter', enter)
    row.addEventListener('pointerleave', leave)
    row.addEventListener('focusin', focusIn)
    row.addEventListener('focusout', focusOut)

    return () => {
      row.removeEventListener('pointerenter', enter)
      row.removeEventListener('pointerleave', leave)
      row.removeEventListener('focusin', focusIn)
      row.removeEventListener('focusout', focusOut)
    }
  }, [ref])

  return active
}

/** One quiet icon button in a row's hover actions, named by its tooltip. */
export function RowAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip content={label}>
      <Button
        variant="quiet"
        size="icon"
        icon={icon}
        aria-label={label}
        className="size-6 text-fg-muted hover:bg-surface hover:text-fg max-md:size-6"
        onClick={onClick}
      />
    </Tooltip>
  )
}
