import { useEffect, useRef } from 'react'

import { Icon } from '#/components/v3/icons'
import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import { paneKind } from '#/lib/workspace-state'

export interface PeekTarget {
  href: string
  title: string
  identifier?: string
  /** Where the record was named: the pane it was read in. */
  from?: string
  /** The element it hangs from, to place the card. */
  rect: { left: number; top: number; bottom: number }
}

const key = (binding: string) => formatShortcut(binding, currentPlatform())

/**
 * A 400px card for the record under the cursor: what it is, where it was
 * named, and the three things to do with it. Opening it is a separate step,
 * so a peek never changes what is on screen.
 */
export function PeekCard({
  target,
  pinned,
  onOpenBeside,
  onOpenHere,
  onPin,
  onClose,
}: {
  target: PeekTarget
  pinned: boolean
  onOpenBeside: () => void
  onOpenHere: () => void
  onPin: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const kind = paneKind(target.href)
  const width = 400
  const left = Math.max(
    8,
    Math.min(target.rect.left, window.innerWidth - width - 8),
  )
  const below = target.rect.bottom + 8
  const flip = below + 190 > window.innerHeight
  const top = flip ? Math.max(8, target.rect.top - 8 - 190) : below

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer, true)
    ref.current
      ?.querySelector<HTMLButtonElement>('[data-peek-default]')
      ?.focus()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="mx-peek"
      role="dialog"
      aria-label={`Peek ${target.identifier ?? target.title}`}
      style={{ left, top }}
      data-workspace-peek
    >
      <div className="mx-peek-h">
        <span className="mx-type">
          <Icon name={kind.icon} size={16} />
        </span>
        {target.identifier ? (
          <span className="mx-id">{target.identifier}</span>
        ) : null}
        <span className="mx-title" style={{ color: 'var(--foreground)' }}>
          {target.title}
        </span>
        <span className="mx-sp" />
        <button
          type="button"
          className="mx-act"
          aria-label="Close peek"
          onClick={onClose}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="mx-peek-b">
        <span>
          {kind.label}
          {target.from ? ` · named in ${target.from}` : ''}
        </span>
        <span>
          Open it to read it. Nothing opens or changes until you choose.
        </span>
      </div>
      <div className="mx-peek-f">
        <button type="button" onClick={onOpenBeside}>
          Open beside <span className="mx-kbd is-inv">{key('alt+enter')}</span>
        </button>
        <button type="button" data-peek-default onClick={onOpenHere}>
          Open here <span className="mx-kbd">↵</span>
        </button>
        <button type="button" onClick={onPin} aria-pressed={pinned}>
          {pinned ? 'On shelf' : 'Pin'} <span className="mx-kbd">P</span>
        </button>
      </div>
    </div>
  )
}
