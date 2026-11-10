import {
  ANNOTATION_COLOR_HEX,
  ANNOTATION_STRIP_FILL,
  annotationHalo,
  sortedLanes,
} from '#/lib/image-annotations'
import type { ImageAnnotation } from '#/lib/image-annotations'

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
  ctx.fillStyle = ANNOTATION_STRIP_FILL
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
      ctx.textAlign = a.x > 0.6 ? 'right' : 'left'
      ctx.lineWidth = 3 * s
      ctx.strokeStyle = annotationHalo(a.color, 0.7)
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
