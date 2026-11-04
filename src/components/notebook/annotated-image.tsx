/**
 * An image with its annotations drawn on top (arrows, labels, lane names).
 * The image itself is never changed; the marks are an SVG layer above it and
 * the lane names sit in a strip above it. `renderAnnotatedPng` bakes the same
 * marks into a PNG copy for slides and papers.
 */
import * as React from 'react'

import { ANNOTATION_COLOR_HEX, sortedLanes } from '#/lib/image-annotations'
import type { ImageAnnotation } from '#/lib/image-annotations'
import { cn } from '#/lib/utils'

export interface ImageSize {
  w: number
  h: number
}

/** One unit of mark size: a mark looks the same on a small or large photo. */
export function markScale({ w, h }: ImageSize): number {
  return Math.max(w, h) / 700
}

export function arrowGeometry(
  a: { x1: number; y1: number; x2: number; y2: number },
  size: ImageSize,
) {
  const s = markScale(size)
  const x1 = a.x1 * size.w
  const y1 = a.y1 * size.h
  const x2 = a.x2 * size.w
  const y2 = a.y2 * size.h
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = 16 * s
  const spread = Math.PI / 7
  const p = (d: number) =>
    `${x2 - head * Math.cos(angle + d)},${y2 - head * Math.sin(angle + d)}`
  return {
    x1,
    y1,
    x2,
    y2,
    head: `${x2},${y2} ${p(-spread)} ${p(spread)}`,
    stroke: 3 * s,
  }
}

/** SVG layer for arrows and labels. Lanes are drawn by the caller. */
export function AnnotationMarks({
  annotations,
  size,
}: {
  annotations: readonly ImageAnnotation[]
  size: ImageSize
}) {
  const s = markScale(size)
  return (
    <>
      {annotations.map((a) => {
        const color = ANNOTATION_COLOR_HEX[a.color]
        if (a.kind === 'arrow') {
          const g = arrowGeometry(a, size)
          return (
            <g key={a.id} data-annotation="arrow">
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
        if (a.kind === 'label') {
          return (
            <text
              key={a.id}
              data-annotation="label"
              x={a.x * size.w}
              y={a.y * size.h}
              fill={color}
              stroke={a.color === 'black' ? '#ffffff' : '#000000'}
              strokeWidth={3 * s}
              strokeOpacity={0.7}
              paintOrder="stroke"
              fontSize={17 * s}
              fontWeight={600}
              dominantBaseline="middle"
            >
              {a.text}
            </text>
          )
        }
        return null
      })}
    </>
  )
}

export function AnnotatedImage({
  src,
  alt,
  annotations,
  className,
  imageClassName,
  children,
  onSize,
}: {
  src: string
  alt: string
  annotations: readonly ImageAnnotation[]
  className?: string
  imageClassName?: string
  /** Drawn above the marks, for the editor's pointer layer. */
  children?: React.ReactNode
  onSize?: (size: ImageSize) => void
}) {
  const [size, setSize] = React.useState<ImageSize | null>(null)
  const lanes = sortedLanes(annotations)
  return (
    <div className={cn('inline-block max-w-full', className)}>
      {lanes.length > 0 ? (
        <div className="relative h-6" data-testid="lane-strip">
          {lanes.map((lane) => (
            <span
              key={lane.id}
              data-annotation="lane"
              className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-sm bg-black/70 px-1 text-label font-semibold leading-5"
              style={{
                left: `${lane.x * 100}%`,
                color: ANNOTATION_COLOR_HEX[lane.color],
              }}
            >
              {lane.text}
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <img
          alt={alt}
          src={src}
          className={cn('block max-w-full rounded-md border', imageClassName)}
          onLoad={(e) => {
            const next = {
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            }
            setSize(next)
            onSize?.(next)
          }}
        />
        {size ? (
          <svg
            aria-hidden="true"
            viewBox={`0 0 ${size.w} ${size.h}`}
            className="pointer-events-none absolute inset-0 size-full"
          >
            <AnnotationMarks annotations={annotations} size={size} />
          </svg>
        ) : null}
        {children}
      </div>
    </div>
  )
}

/** Bake the marks into a PNG. The stored original is not touched. */
export async function renderAnnotatedPng(
  src: string,
  annotations: readonly ImageAnnotation[],
): Promise<Blob> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = src
  await img.decode()
  const size = { w: img.naturalWidth, h: img.naturalHeight }
  const s = markScale(size)
  const lanes = sortedLanes(annotations)
  const strip = lanes.length > 0 ? Math.round(30 * s) : 0
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h + strip
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, strip)
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.textAlign = 'center'
  ctx.font = `600 ${15 * s}px sans-serif`
  for (const lane of lanes) {
    ctx.fillStyle = ANNOTATION_COLOR_HEX[lane.color]
    ctx.fillText(lane.text, lane.x * size.w, strip / 2)
  }
  ctx.textAlign = 'left'
  ctx.font = `600 ${17 * s}px sans-serif`
  for (const a of annotations) {
    const color = ANNOTATION_COLOR_HEX[a.color]
    if (a.kind === 'arrow') {
      const g = arrowGeometry(a, size)
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = g.stroke
      ctx.beginPath()
      ctx.moveTo(g.x1, g.y1 + strip)
      ctx.lineTo(g.x2, g.y2 + strip)
      ctx.stroke()
      const pts = g.head.split(' ').map((p) => p.split(',').map(Number))
      ctx.beginPath()
      pts.forEach(([x, y], i) =>
        i === 0 ? ctx.moveTo(x, y + strip) : ctx.lineTo(x, y + strip),
      )
      ctx.closePath()
      ctx.fill()
    } else if (a.kind === 'label') {
      ctx.lineWidth = 3 * s
      ctx.strokeStyle =
        a.color === 'black' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.7)'
      ctx.strokeText(a.text, a.x * size.w, a.y * size.h + strip)
      ctx.fillStyle = color
      ctx.fillText(a.text, a.x * size.w, a.y * size.h + strip)
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('could not encode PNG'))),
      'image/png',
    ),
  )
}
