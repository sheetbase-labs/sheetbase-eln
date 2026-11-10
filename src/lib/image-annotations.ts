/**
 * Annotations drawn on a notebook image (gel photos, microscopy, blots).
 * They live beside the file reference in the file block's payload and never
 * touch the stored image, so the original stays exactly as it was uploaded.
 * Positions are fractions of the image (0 to 1), so they hold at any size.
 */
import { z } from 'zod'

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

/** A position on the image: a fraction of its width or height. */
const unit = z.number().min(0).max(1)

/** A colour on the palette; a mark that names none keeps the default yellow. */
const annotationColour = z.enum(ANNOTATION_COLORS).catch('yellow')

/** Label text: trimmed, capped, and refused when nothing readable is left. */
const annotationText = z
  .string()
  .transform((text) => text.trim().slice(0, MAX_ANNOTATION_TEXT))
  .refine((text) => text.length > 0)

const arrowAnnotation = z.object({
  id: z.string().min(1),
  kind: z.literal('arrow'),
  x1: unit,
  y1: unit,
  x2: unit,
  y2: unit,
  color: annotationColour,
})

const labelAnnotation = z.object({
  id: z.string().min(1),
  kind: z.literal('label'),
  x: unit,
  y: unit,
  text: annotationText,
  color: annotationColour,
})

const laneAnnotation = z.object({
  id: z.string().min(1),
  kind: z.literal('lane'),
  x: unit,
  text: annotationText,
  color: annotationColour,
})

/** One stored mark; a malformed mark is dropped rather than repaired. */
const storedAnnotation = z.discriminatedUnion('kind', [
  arrowAnnotation,
  labelAnnotation,
  laneAnnotation,
])

/** A payload that carries a marks list at all; each mark is decoded on its own. */
const annotationsList = z.looseObject({ annotations: z.array(z.unknown()) })

/** Read annotations out of a file block payload, dropping anything malformed. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored file block payload is arbitrary JSON; every mark is decoded by `storedAnnotation` before it is returned.
export function readAnnotations(payload: unknown): ImageAnnotation[] {
  const list = annotationsList.safeParse(payload)

  if (!list.success) return []
  const out: ImageAnnotation[] = []

  for (const raw of list.data.annotations.slice(0, MAX_ANNOTATIONS)) {
    const mark = storedAnnotation.safeParse(raw)

    if (mark.success) out.push(mark.data)
  }

  return out
}

/** True when the payload's `annotations` is absent or fully well formed. */
export function annotationsAreValid(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The caller hands over NotebookBlock.payload, whose stored JSON fields are Record<string, unknown>; only `annotations` is read.
  payload: Record<string, unknown>,
): boolean {
  if (payload.annotations === undefined) return true

  if (!Array.isArray(payload.annotations)) return false

  if (payload.annotations.length > MAX_ANNOTATIONS) return false

  return readAnnotations(payload).length === payload.annotations.length
}

/** The file payload with these annotations (removed entirely when empty). */
export function withAnnotations(
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- NotebookBlock.payload is the stored JSON record this returns a copy of; only `annotations` is replaced.
  payload: Record<string, unknown>,
  annotations: readonly ImageAnnotation[],
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The result is the same stored block payload the caller passed in, with `annotations` replaced.
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
