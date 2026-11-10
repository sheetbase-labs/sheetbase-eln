/**
 * An image with its annotations drawn on top (arrows, labels, lane names).
 * The image itself is never changed; the marks are an SVG layer above it and
 * the lane names sit in a strip above it. `renderAnnotatedPng` bakes the same
 * marks into a PNG copy for slides and papers.
 */
import * as React from 'react'

import {
  ANNOTATION_COLOR_HEX,
  annotationHalo,
  sortedLanes,
} from '#/lib/image-annotations'
import type { ImageAnnotation } from '#/lib/image-annotations'
import { cn } from '#/lib/utils'
import { arrowGeometry, markScale } from './image-annotation-rendering'
import type { ImageSize } from './image-annotation-rendering'

export type { ImageSize } from './image-annotation-rendering'

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
              stroke={annotationHalo(a.color)}
              strokeWidth={3 * s}
              strokeOpacity={0.7}
              paintOrder="stroke"
              fontSize={17 * s}
              fontWeight={600}
              textAnchor={a.x > 0.6 ? 'end' : 'start'}
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
