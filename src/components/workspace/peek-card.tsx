import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Icon } from '#/components/icons'
import { fetchPeekSummary, humanise } from '#/lib/peek-summary'
import { currentPlatform, formatShortcut } from '#/lib/shortcuts'
import { paneKind } from '#/lib/workspace-state'
import { t } from '#/copy'

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

/** A 400px card, kept this far from the window's edges. */
const PEEK_WIDTH = 400
const EDGE = 8

/** Where the card sits in the window. */
interface PeekPlacement {
  left: number
  top: number
}

/** The window the card is placed inside, or nothing while rendering on the server. */
function viewportSize(): { width: number; height: number } {
  return typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight }
}

/**
 * Below the link it hangs from, so the row being peeked stays readable; above
 * it when the card would run off the bottom and there is room.
 */
function peekPlacement(
  rect: PeekTarget['rect'],
  height: number,
  viewport: { width: number; height: number },
): PeekPlacement {
  const left = Math.max(
    EDGE,
    Math.min(rect.left, viewport.width - PEEK_WIDTH - EDGE),
  )

  const below = rect.bottom + EDGE
  const above = rect.top - EDGE - height
  const flip = below + height > viewport.height - EDGE && above >= EDGE

  return {
    left,
    top: flip
      ? above
      : Math.max(EDGE, Math.min(below, viewport.height - EDGE - height)),
  }
}

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
  const { left, top } = peekPlacement(target.rect, height, viewportSize())

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
      const node = event.target instanceof Node ? event.target : null

      if (ref.current && !ref.current.contains(node)) onClose()
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
      // react-doctor-disable-next-line react-doctor/prefer-html-dialog -- A peek is a non-modal card anchored to the link it describes: a native dialog would trap focus and make the workspace inert, which is exactly what a peek must not do.
      role="dialog"
      aria-label={t('projects.peek.label', {
        name: target.identifier ?? target.title,
      })}
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
          aria-label={t('projects.peek.close')}
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
          <span className="mx-peek-note">{t('projects.peek.reading')}</span>
        ) : (
          <span className="mx-peek-note">{t('projects.peek.openToRead')}</span>
        )}
        {target.from ? (
          <span className="mx-peek-note">
            {t('projects.peek.namedIn', { from: target.from })}
          </span>
        ) : null}
      </div>
      <div className="mx-peek-f">
        <button type="button" onClick={onOpenBeside}>
          {t('projects.peek.openBeside')}{' '}
          <span className="mx-kbd is-inv">{key('alt+enter')}</span>
        </button>
        <button type="button" data-peek-default onClick={onOpenHere}>
          {t('projects.peek.openHere')} <span className="mx-kbd">↵</span>
        </button>
        <button type="button" onClick={onPin} aria-pressed={pinned}>
          {pinned ? t('projects.peek.onShelf') : t('projects.peek.pin')}{' '}
          <span className="mx-kbd">P</span>
        </button>
      </div>
    </div>
  )
}
