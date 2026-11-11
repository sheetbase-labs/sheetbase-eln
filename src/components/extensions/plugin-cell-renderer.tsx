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
import { z } from 'zod'

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

/** A cell value as the sheet holds it: the same JSON a block payload carries. */
type PluginCellValue = z.core.util.JSONType

const IMAGE_RE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/

/** One cell of a renderer's answer, decoded from the frame's message. */
const renderedAnswerSchema = z.looseObject({
  key: z.number(),
  svg: z.string().optional().catch(undefined),
  image: z.string().optional().catch(undefined),
  text: z.string().optional().catch(undefined),
  tone: z.string().optional().catch(undefined),
})

type RenderedAnswer = z.infer<typeof renderedAnswerSchema>

/** A message from a renderer's frame: the frame protocol's own envelope. */
const frameMessageSchema = z.looseObject({
  sb: z.literal(1),
  type: z.string(),
  id: z.string().optional(),
  cells: z.array(renderedAnswerSchema).catch([]),
  error: z.unknown(),
})

function isTone(key: string): key is keyof typeof TONE_CLASSES {
  return Object.hasOwn(TONE_CLASSES, key)
}

/** What a renderer sent back for one cell, kept only if it is one of the shapes Sheetbase draws. */
function checked(answer: RenderedAnswer): RenderedCell | null {
  const out: RenderedCell = {}

  if (answer.svg !== undefined) {
    const clean = sanitizeSvg(answer.svg)

    if (clean) out.svg = clean
  }

  if (answer.image !== undefined && IMAGE_RE.test(answer.image))
    out.image = answer.image

  if (answer.text !== undefined) out.text = answer.text.slice(0, 500)

  if (answer.tone !== undefined && isTone(answer.tone)) out.tone = answer.tone

  return out.svg || out.image || out.text !== undefined ? out : null
}

interface Waiting {
  value: PluginCellValue
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
    const parsed = frameMessageSchema.safeParse(event.data)

    if (!parsed.success) return

    const message = parsed.data

    if (message.type === 'ready') {
      this.ready = true
      this.sendContext()
      this.flush()
    } else if (message.type === 'rendered' && message.id !== undefined) {
      const waiting = this.inflight.get(message.id)

      if (!waiting) return
      this.inflight.delete(message.id)

      waiting.forEach((entry, index) => {
        const cell = message.cells.find((answer) => answer.key === index)
        const rendered = !message.error && cell ? checked(cell) : null

        entry.resolve(rendered)
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

  render(value: PluginCellValue): Promise<RenderedCell | null> {
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
  value: PluginCellValue | undefined
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
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- The value is read through `key`, which is its JSON form: listing `value` would re-run the effect for a new object with the same contents.
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
