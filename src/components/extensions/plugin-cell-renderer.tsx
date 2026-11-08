/**
 * Table cells drawn by a plugin's own code.
 *
 * A cell renderer is a UI bundle (a table cell point's `render`). One hidden
 * sandboxed frame per renderer is started the first time a cell needs it; the
 * cells on screen are sent to it in batches and it hands back, for each, SVG
 * markup, a `data:image/…;base64,` picture or plain text. Sheetbase draws what
 * comes back: SVG goes through the same sanitizer as every plugin SVG and a
 * picture is only ever shown as an image, so no plugin code runs in a cell.
 *
 * Answers are remembered for the page's lifetime, per renderer and value, and
 * dropped when the theme changes, because a renderer can draw in the app's
 * colours.
 */
import * as React from 'react'

import { sanitizeSvg } from '#/lib/extensions/screens'
import { cn } from '#/lib/utils'
import { t } from '#/copy'
import { readTheme } from './plugin-frame'
import { TONE_CLASSES } from './tone'

export interface RenderedCell {
  svg?: string
  image?: string
  text?: string
  tone?: keyof typeof TONE_CLASSES
}

const IMAGE_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/
const TONES = Object.keys(TONE_CLASSES)

/** What a renderer sent back for one cell, kept only if it is one of the shapes Sheetbase draws. */
function checked(value: unknown): RenderedCell | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const out: RenderedCell = {}
  if (typeof v.svg === 'string') {
    const clean = sanitizeSvg(v.svg)
    if (clean) out.svg = clean
  }
  if (typeof v.image === 'string' && IMAGE_RE.test(v.image)) out.image = v.image
  if (typeof v.text === 'string') out.text = v.text.slice(0, 500)
  if (typeof v.tone === 'string' && TONES.includes(v.tone))
    out.tone = v.tone as RenderedCell['tone']
  return out.svg || out.image || out.text !== undefined ? out : null
}

interface Waiting {
  value: unknown
  resolve: (cell: RenderedCell | null) => void
}

class RendererHost {
  private readonly frame: HTMLIFrameElement
  private ready = false
  private queue: Waiting[] = []
  private scheduled = false
  private counter = 0
  private inflight = new Map<string, Waiting[]>()
  private cache = new Map<string, RenderedCell | null>()
  private readonly listener: (event: MessageEvent) => void

  constructor(
    extensionKey: string,
    private readonly itemId: string,
  ) {
    this.frame = document.createElement('iframe')
    this.frame.setAttribute('sandbox', 'allow-scripts')
    this.frame.setAttribute('referrerpolicy', 'no-referrer')
    this.frame.setAttribute('aria-hidden', 'true')
    this.frame.tabIndex = -1
    this.frame.title = `${extensionKey} cell renderer`
    Object.assign(this.frame.style, {
      position: 'fixed',
      width: '320px',
      height: '120px',
      opacity: '0',
      pointerEvents: 'none',
      border: '0',
      left: '-10000px',
      top: '0',
    })
    this.frame.src = `/api/plugins/${extensionKey}/ui/${itemId}?point=table-cells`
    this.listener = (event) => this.onMessage(event)
    window.addEventListener('message', this.listener)
    document.body.appendChild(this.frame)
    const observer = new MutationObserver(() => {
      this.cache.clear()
      this.sendContext()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  }

  private sendContext() {
    this.frame.contentWindow?.postMessage(
      { sb: 1, type: 'context', context: {}, state: null, ...readTheme() },
      '*',
    )
  }

  private onMessage(event: MessageEvent) {
    if (event.source !== this.frame.contentWindow) return
    const data: unknown = event.data
    if (typeof data !== 'object' || data === null) return
    const message = data as Record<string, unknown>
    if (message.sb !== 1) return
    if (message.type === 'ready') {
      this.ready = true
      this.sendContext()
      this.flush()
    } else if (message.type === 'rendered' && typeof message.id === 'string') {
      const waiting = this.inflight.get(message.id)
      if (!waiting) return
      this.inflight.delete(message.id)
      const cells = Array.isArray(message.cells)
        ? (message.cells as Array<Record<string, unknown>>)
        : []
      waiting.forEach((entry, index) => {
        const answer = message.error
          ? null
          : checked(cells.find((c) => c.key === index))
        entry.resolve(answer)
      })
    }
  }

  private flush() {
    if (!this.ready || this.queue.length === 0) return
    const batch = this.queue
    this.queue = []
    this.counter += 1
    const id = `r${this.counter}`
    this.inflight.set(id, batch)
    this.frame.contentWindow?.postMessage(
      {
        sb: 1,
        type: 'render',
        id,
        cells: batch.map((entry, key) => ({ key, value: entry.value })),
        context: { itemId: this.itemId },
      },
      '*',
    )
  }

  render(value: unknown): Promise<RenderedCell | null> {
    const key = JSON.stringify(value ?? null)
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key) ?? null)
    return new Promise((resolve) => {
      this.queue.push({
        value,
        resolve: (cell) => {
          this.cache.set(key, cell)
          resolve(cell)
        },
      })
      if (!this.scheduled) {
        this.scheduled = true
        setTimeout(() => {
          this.scheduled = false
          this.flush()
        }, 16)
      }
    })
  }
}

const hosts = new Map<string, RendererHost>()

function hostFor(extensionKey: string, itemId: string): RendererHost {
  const id = `${extensionKey}/${itemId}`
  let host = hosts.get(id)
  if (!host) {
    host = new RendererHost(extensionKey, itemId)
    hosts.set(id, host)
  }
  return host
}

/** One cell, drawn by a plugin's renderer. Shows a dash until the renderer has answered, and again if it cannot. */
export function PluginCell({
  extensionKey,
  itemId,
  value,
  className,
}: {
  extensionKey: string
  itemId: string
  value: unknown
  className?: string
}) {
  const [cell, setCell] = React.useState<RenderedCell | null | undefined>(
    undefined,
  )
  const key = JSON.stringify(value ?? null)
  React.useEffect(() => {
    let live = true
    setCell(undefined)
    if (value === null || value === undefined || value === '') {
      setCell(null)
      return
    }
    void hostFor(extensionKey, itemId)
      .render(value)
      .then((answer) => {
        if (live) setCell(answer)
      })
    return () => {
      live = false
    }
    // `key` stands for the value, so an unchanged value is not drawn again.
  }, [extensionKey, itemId, key])

  if (cell === undefined || cell === null)
    return (
      <span
        className={cn('text-fg-faint', className)}
        title={cell === null ? t('plugins.hooks.cellFailed') : undefined}
      >
        —
      </span>
    )
  return (
    <span
      data-slot="plugin-cell"
      className={cn(
        'inline-flex max-w-full items-center gap-1.5',
        cell.tone && `rounded-sm px-1.5 py-px ${TONE_CLASSES[cell.tone]}`,
        className,
      )}
    >
      {cell.svg ? (
        <span
          className="inline-block h-5 [&>svg]:h-full [&>svg]:w-auto"
          dangerouslySetInnerHTML={{ __html: cell.svg }}
        />
      ) : null}
      {cell.image ? (
        <img src={cell.image} alt="" className="h-5 w-auto" />
      ) : null}
      {cell.text !== undefined ? (
        <span className="truncate">{cell.text}</span>
      ) : null}
    </span>
  )
}
