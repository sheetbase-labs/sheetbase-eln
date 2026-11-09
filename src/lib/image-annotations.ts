/**
 * Annotations drawn on a notebook image (gel photos, microscopy, blots).
 * They live beside the file reference in the file block's payload and never
 * touch the stored image, so the original stays exactly as it was uploaded.
 * Positions are fractions of the image (0 to 1), so they hold at any size.
 */

export const ANNOTATION_COLORS = [
  'yellow',
  'red',
  'white',
  'black',
  'cyan',
] as const

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

export const ANNOTATION_COLOR_HEX: Record<AnnotationColor, string> = {
  yellow: '#facc15',
  red: '#ef4444',
  white: '#ffffff',
  black: '#111111',
  cyan: '#22d3ee',
}

/** Outline drawn round label text so it stays readable on any image. */
export function annotationHalo(color: AnnotationColor, alpha = 1): string {
  return color === 'black'
    ? `rgba(255, 255, 255, ${alpha})`
    : `rgba(0, 0, 0, ${alpha})`
}

/** Background of the lane-name strip burned into an exported image. */
export const ANNOTATION_STRIP_FILL = '#000000'

export const MAX_ANNOTATIONS = 100
export const MAX_ANNOTATION_TEXT = 60

export type ImageAnnotation =
  | {
      id: string
      kind: 'arrow'
      x1: number
      y1: number
      x2: number
      y2: number
      color: AnnotationColor
    }
  | {
      id: string
      kind: 'label'
      x: number
      y: number
      text: string
      color: AnnotationColor
    }
  | {
      /** A lane name written above the image, lined up with a gel lane. */
      id: string
      kind: 'lane'
      x: number
      text: string
      color: AnnotationColor
    }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function unit(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
    ? v
    : null
}

function colorOf(v: unknown): AnnotationColor {
  return ANNOTATION_COLORS.includes(v as AnnotationColor)
    ? (v as AnnotationColor)
    : 'yellow'
}

function textOf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, MAX_ANNOTATION_TEXT)

  return s.length > 0 ? s : null
}

/** Read annotations out of a file block payload, dropping anything malformed. */
export function readAnnotations(payload: unknown): ImageAnnotation[] {
  if (!isRecord(payload) || !Array.isArray(payload.annotations)) return []
  const out: ImageAnnotation[] = []

  for (const raw of payload.annotations.slice(0, MAX_ANNOTATIONS)) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') continue
    const color = colorOf(raw.color)

    if (raw.kind === 'arrow') {
      const x1 = unit(raw.x1)
      const y1 = unit(raw.y1)
      const x2 = unit(raw.x2)
      const y2 = unit(raw.y2)

      if (x1 === null || y1 === null || x2 === null || y2 === null) continue
      out.push({ id: raw.id, kind: 'arrow', x1, y1, x2, y2, color })
    } else if (raw.kind === 'label') {
      const x = unit(raw.x)
      const y = unit(raw.y)
      const text = textOf(raw.text)

      if (x === null || y === null || text === null) continue
      out.push({ id: raw.id, kind: 'label', x, y, text, color })
    } else if (raw.kind === 'lane') {
      const x = unit(raw.x)
      const text = textOf(raw.text)

      if (x === null || text === null) continue
      out.push({ id: raw.id, kind: 'lane', x, text, color })
    }
  }

  return out
}

/** True when the payload's `annotations` is absent or fully well formed. */
export function annotationsAreValid(payload: Record<string, unknown>): boolean {
  if (payload.annotations === undefined) return true

  if (!Array.isArray(payload.annotations)) return false

  if (payload.annotations.length > MAX_ANNOTATIONS) return false

  return readAnnotations(payload).length === payload.annotations.length
}

/** The file payload with these annotations (removed entirely when empty). */
export function withAnnotations(
  payload: Record<string, unknown>,
  annotations: readonly ImageAnnotation[],
): Record<string, unknown> {
  const { annotations: _old, ...rest } = payload

  return annotations.length === 0 ? rest : { ...rest, annotations }
}

export function newAnnotationId(): string {
  return `a${Math.random().toString(36).slice(2, 10)}`
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Lanes read left to right, whatever order they were added in. */
export function sortedLanes(annotations: readonly ImageAnnotation[]) {
  return annotations
    .filter(
      (a): a is Extract<ImageAnnotation, { kind: 'lane' }> => a.kind === 'lane',
    )
    .sort((a, b) => a.x - b.x)
}
