import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Icon } from '#/components/v3/icons'
import { fetchPeekSummary, humanise } from '#/lib/peek-summary'
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

/** The dot beside a status: green when settled, amber when waiting, red when wrong. */
function statusTone(status: string): 'good' | 'wait' | 'bad' | 'none' {
  const value = status.toLowerCase()
  if (/fail|error|reject|retire|overdue|expired|quarantine|issue/.test(value))
    return 'bad'
  if (/hold|review|draft|pending|waiting|returned|submitted/.test(value))
    return 'wait'
  if (
    /progress|active|complete|signed|approved|publish|available|connect|effective|current|ready/.test(
      value,
    )
  )
    return 'good'
  return 'none'
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
  const summary = useQuery({
    queryKey: ['workspace', 'peek', target.href],
    queryFn: () => fetchPeekSummary(target.href),
    staleTime: 30_000,
    retry: 0,
  })
  const [height, setHeight] = useState(190)
  const width = 400
  const left = Math.max(
    8,
    Math.min(target.rect.left, window.innerWidth - width - 8),
  )
  // Below the link it hangs from, so the row being peeked stays readable;
  // above it when the card would run off the bottom and there is room.
  const below = target.rect.bottom + 8
  const above = target.rect.top - 8 - height
  const flip = below + height > window.innerHeight - 8 && above >= 8
  const top = flip
    ? above
    : Math.max(8, Math.min(below, window.innerHeight - 8 - height))

  // The card grows once the summary arrives, so place it by what it measures.
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setHeight(node.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const data = summary.data ?? null
  const identifier = data?.identifier ?? target.identifier
  const title = data?.title ?? target.title

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
        {identifier ? <span className="mx-id">{identifier}</span> : null}
        <span className="mx-title">{title}</span>
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
        <div className="mx-peek-kind">
          <span>{data?.kindLabel ?? kind.label}</span>
          {data?.status ? (
            <span
              className="mx-peek-status"
              data-tone={statusTone(data.status)}
            >
              {humanise(data.status)}
            </span>
          ) : null}
        </div>
        {data?.description ? (
          <p className="mx-peek-desc">{data.description}</p>
        ) : null}
        {data && data.facts.length > 0 ? (
          <dl className="mx-peek-facts">
            {data.facts.map((entry) => (
              <div key={entry.label}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        ) : summary.isPending ? (
          <span className="mx-peek-note">Reading…</span>
        ) : (
          <span className="mx-peek-note">
            Open it to read it. Nothing opens or changes until you choose.
          </span>
        )}
        {target.from ? (
          <span className="mx-peek-note">Named in {target.from}</span>
        ) : null}
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
