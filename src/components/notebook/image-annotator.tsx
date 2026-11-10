/**
 * The annotate dialog for a notebook image: draw arrows, drop labels and name
 * gel lanes. Saves only the marks; the uploaded image is never rewritten.
 */
import * as React from 'react'

import { t } from '#/copy'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { IconButton } from '#/components/ui/icon-button'
import { Notice } from '#/components/ui/alert'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/ui/dialog'
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_HEX,
  MAX_ANNOTATIONS,
  MAX_ANNOTATION_TEXT,
  clamp01,
  newAnnotationId,
} from '#/lib/image-annotations'
import type { AnnotationColor, ImageAnnotation } from '#/lib/image-annotations'
import { cn } from '#/lib/utils'
import { AnnotatedImage, AnnotationMarks } from './annotated-image'
import { arrowGeometry } from './image-annotation-rendering'
import type { ImageSize } from './image-annotation-rendering'

type Tool = 'arrow' | 'label' | 'lane'

const TOOLS: readonly Tool[] = ['arrow', 'label', 'lane']

function toolName(tool: Tool) {
  return tool === 'arrow'
    ? t('notebook.imageAnnotations.toolArrow')
    : tool === 'label'
      ? t('notebook.imageAnnotations.toolLabel')
      : t('notebook.imageAnnotations.toolLane')
}

function toolHint(tool: Tool) {
  return tool === 'arrow'
    ? t('notebook.imageAnnotations.toolHintArrow')
    : tool === 'label'
      ? t('notebook.imageAnnotations.toolHintLabel')
      : t('notebook.imageAnnotations.toolHintLane')
}

function colourName(c: AnnotationColor) {
  return t(`notebook.imageAnnotations.colours.${c}`)
}

function itemName(a: ImageAnnotation) {
  return a.kind === 'arrow'
    ? t('notebook.imageAnnotations.arrowItem')
    : a.kind === 'label'
      ? t('notebook.imageAnnotations.labelItem', { text: a.text })
      : t('notebook.imageAnnotations.laneItem', { text: a.text })
}

export function ImageAnnotator({
  open,
  onOpenChange,
  src,
  name,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  src: string
  name: string
  initial: readonly ImageAnnotation[]
  onSave: (annotations: ImageAnnotation[]) => Promise<void>
}) {
  const [draft, setDraft] = React.useState<ImageAnnotation[]>([...initial])
  const [tool, setTool] = React.useState<Tool>('arrow')
  const [color, setColor] = React.useState<AnnotationColor>('yellow')
  const [size, setSize] = React.useState<ImageSize | null>(null)

  const [dragStart, setDragStart] = React.useState<{
    x: number
    y: number
  } | null>(null)

  const [dragNow, setDragNow] = React.useState<{ x: number; y: number } | null>(
    null,
  )

  const [pending, setPending] = React.useState<{ x: number; y: number } | null>(
    null,
  )

  const [text, setText] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [wasOpen, setWasOpen] = React.useState(open)

  if (wasOpen !== open) {
    setWasOpen(open)

    if (open) {
      setDraft([...initial])
      setPending(null)
      setError(null)
    }
    // An open editing session keeps its draft when initial data refreshes.
  }

  const full = draft.length >= MAX_ANNOTATIONS

  function point(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()

    return {
      x: clamp01((e.clientX - r.left) / r.width),
      y: clamp01((e.clientY - r.top) / r.height),
    }
  }

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    if (full) return
    const p = point(e)

    if (tool === 'arrow') {
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragStart(p)
      setDragNow(p)
    } else {
      setPending(p)
      setText('')
    }
  }

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStart) setDragNow(point(e))
  }

  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart) return
    const end = point(e)
    const moved = Math.hypot(end.x - dragStart.x, end.y - dragStart.y)

    if (moved > 0.02) {
      setDraft((d) => [
        ...d,
        {
          id: newAnnotationId(),
          kind: 'arrow',
          x1: dragStart.x,
          y1: dragStart.y,
          x2: end.x,
          y2: end.y,
          color,
        },
      ])
    }

    setDragStart(null)
    setDragNow(null)
  }

  function addText(e: React.FormEvent) {
    e.preventDefault()
    const value = text.trim()

    if (!pending || value === '') return
    setDraft((d) => [
      ...d,
      tool === 'lane'
        ? {
            id: newAnnotationId(),
            kind: 'lane',
            x: pending.x,
            text: value,
            color,
          }
        : {
            id: newAnnotationId(),
            kind: 'label',
            x: pending.x,
            y: pending.y,
            text: value,
            color,
          },
    ])
    setPending(null)
    setText('')
  }

  async function save() {
    setSaving(true)
    setError(null)

    try {
      await onSave(draft)
      onOpenChange(false)
    } catch {
      setError(t('notebook.imageAnnotations.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const preview =
    dragStart && dragNow && size ? (
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="pointer-events-none absolute inset-0 size-full"
      >
        <PreviewArrow
          from={dragStart}
          to={dragNow}
          size={size}
          color={ANNOTATION_COLOR_HEX[color]}
        />
      </svg>
    ) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[4vh] max-h-[92vh] w-[min(980px,calc(100vw-32px))]">
        <DialogHeader
          title={t('notebook.imageAnnotations.title')}
          description={t('notebook.imageAnnotations.description')}
        />
        <DialogBody>
          <AnnotationTools
            tool={tool}
            color={color}
            canUndo={draft.length > 0}
            onToolChange={(next) => {
              setTool(next)
              setPending(null)
            }}
            onColorChange={setColor}
            onUndo={() => setDraft((d) => d.slice(0, -1))}
          />
          <p className="text-caption text-fg-muted">
            {full
              ? t('notebook.imageAnnotations.tooMany', { max: MAX_ANNOTATIONS })
              : toolHint(tool)}
          </p>

          {pending ? (
            <form onSubmit={addText} className="flex items-center gap-2">
              <Input
                autoFocus
                value={text}
                maxLength={MAX_ANNOTATION_TEXT}
                aria-label={t('notebook.imageAnnotations.textLabel')}
                placeholder={
                  tool === 'lane'
                    ? t('notebook.imageAnnotations.textPlaceholderLane')
                    : t('notebook.imageAnnotations.textPlaceholderLabel')
                }
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setPending(null)
                  }
                }}
              />
              <Button type="submit" variant="primary" disabled={!text.trim()}>
                {t('notebook.imageAnnotations.addText')}
              </Button>
              <Button variant="quiet" onClick={() => setPending(null)}>
                {t('notebook.imageAnnotations.cancelText')}
              </Button>
            </form>
          ) : null}

          <div className="shrink-0 overflow-auto rounded-md bg-surface-muted p-2">
            <AnnotatedImage
              src={src}
              alt={name}
              annotations={draft}
              onSize={setSize}
              imageClassName="max-h-[46vh] w-auto"
            >
              {preview}
              {pending ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary"
                  style={{
                    left: `${pending.x * 100}%`,
                    top: `${pending.y * 100}%`,
                  }}
                />
              ) : null}
              <div
                role="application"
                aria-label={t('notebook.imageAnnotations.canvasArea')}
                data-testid="annotation-canvas"
                className="absolute inset-0 cursor-crosshair touch-none"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => {
                  setDragStart(null)
                  setDragNow(null)
                }}
                onLostPointerCapture={() => {
                  setDragStart(null)
                  setDragNow(null)
                }}
              />
            </AnnotatedImage>
          </div>

          <AnnotationList
            annotations={draft}
            onRemove={(id) => setDraft((d) => d.filter((a) => a.id !== id))}
          />
          {error ? <Notice tone="bad">{error}</Notice> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="quiet" onClick={() => onOpenChange(false)}>
            {t('notebook.imageAnnotations.cancel')}
          </Button>
          <Button variant="primary" disabled={saving} onClick={save}>
            {saving
              ? t('notebook.imageAnnotations.saving')
              : t('notebook.imageAnnotations.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AnnotationTools({
  tool,
  color,
  canUndo,
  onToolChange,
  onColorChange,
  onUndo,
}: {
  tool: Tool
  color: AnnotationColor
  canUndo: boolean
  onToolChange: (tool: Tool) => void
  onColorChange: (color: AnnotationColor) => void
  onUndo: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label={t('notebook.imageAnnotations.title')}
        className="flex gap-1"
      >
        {TOOLS.map((tl) => (
          <Button
            key={tl}
            size="sm"
            variant={tool === tl ? 'primary' : 'secondary'}
            aria-pressed={tool === tl}
            onClick={() => onToolChange(tl)}
          >
            {toolName(tl)}
          </Button>
        ))}
      </div>
      <div
        role="group"
        aria-label={t('notebook.imageAnnotations.colour')}
        className="flex items-center gap-1"
      >
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={colourName(c)}
            aria-pressed={color === c}
            onClick={() => onColorChange(c)}
            className={cn(
              'size-5 rounded-full border border-border-strong max-md:size-8',
              color === c && 'outline-2 outline-offset-2 outline-focus',
            )}
            style={{ backgroundColor: ANNOTATION_COLOR_HEX[c] }}
          />
        ))}
      </div>
      <div className="ml-auto flex gap-1">
        <Button size="sm" variant="quiet" disabled={!canUndo} onClick={onUndo}>
          {t('notebook.imageAnnotations.undo')}
        </Button>
      </div>
    </div>
  )
}

function AnnotationList({
  annotations,
  onRemove,
}: {
  annotations: readonly ImageAnnotation[]
  onRemove: (id: string) => void
}) {
  return (
    <section aria-labelledby="annotation-list-title" className="shrink-0">
      <h3 id="annotation-list-title" className="text-label font-medium">
        {t('notebook.imageAnnotations.listTitle')}
      </h3>
      {annotations.length === 0 ? (
        <p className="mt-1 text-caption text-fg-muted">
          {t('notebook.imageAnnotations.listEmpty')}
        </p>
      ) : (
        <ul className="mt-1 flex max-h-36 flex-col divide-y divide-border-subtle overflow-auto">
          {annotations.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1 text-body">
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border border-border-strong"
                style={{ backgroundColor: ANNOTATION_COLOR_HEX[a.color] }}
              />
              <span className="min-w-0 flex-1 truncate">{itemName(a)}</span>
              <IconButton
                icon="trash"
                label={t('notebook.imageAnnotations.remove', {
                  item: itemName(a),
                })}
                onClick={() => onRemove(a.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function PreviewArrow({
  from,
  to,
  size,
  color,
}: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  size: ImageSize
  color: string
}) {
  const g = arrowGeometry({ x1: from.x, y1: from.y, x2: to.x, y2: to.y }, size)

  return (
    <g opacity={0.8}>
      <line
        x1={g.x1}
        y1={g.y1}
        x2={g.x2}
        y2={g.y2}
        stroke={color}
        strokeWidth={g.stroke}
        strokeLinecap="round"
      />
      <polygon points={g.head} fill={color} />
    </g>
  )
}

export { AnnotationMarks }
