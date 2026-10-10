/**
 * LAB-05.1 — the label a printed code carries.
 *
 * DEC-10 fixes the 2D code's payload: `https://<host>/r/<identifier>`, so a scan
 * resolves the object the label names through the resolver route. The payload is built
 * here, in one place, so the printed code and the route that reads it cannot drift.
 *
 * The label's lines are the identifier, the lot and the storage condition with its
 * hold use-by date. A line is omitted when the record does not carry the fact rather
 * than being filled with a placeholder.
 */
import { z } from 'zod'

/** The path the resolver route serves; the QR payload's path component. */
export const LABEL_QR_PATH = '/r/'

export const labelTemplateSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    name: z.string().min(1).max(120),
    /** The record kind this template labels, e.g. 'sample'. */
    recordKind: z.string().min(1).max(48),
    showCondition: z.boolean(),
    showUseBy: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

export type LabelTemplate = z.infer<typeof labelTemplateSchema>

export function parseLabelTemplate(value: unknown): LabelTemplate {
  return labelTemplateSchema.parse(value)
}

/**
 * The exact string a label's 2D code encodes. `host` may be a bare host or carry a
 * scheme; a bare host gets `https://`, because a printed code is scanned by a camera
 * that has no page context to inherit.
 */
export function labelQrPayload(host: string, identifier: string): string {
  const trimmedHost = host.trim().replace(/\/+$/, '')
  if (!trimmedHost) throw new Error('A label needs a host to build its code.')
  const base = /^https?:\/\//i.test(trimmedHost)
    ? trimmedHost
    : `https://${trimmedHost}`
  return `${base}${LABEL_QR_PATH}${encodeURIComponent(identifier.trim())}`
}

export interface LabelSource {
  identifier: string
  lot?: string | null
  condition?: string | null
  useBy?: string | null
}

export interface LabelLine {
  /** Which fact the line carries, so a caller can label or hide it. */
  kind: 'identifier' | 'lot' | 'storage'
  text: string
}

/**
 * The label's machine lines. The storage line carries the condition and the use-by
 * date together only when both are known; a date with no condition still prints,
 * because the date alone is the operative fact on a bench.
 */
export function buildLabelLines(source: LabelSource): LabelLine[] {
  const lines: LabelLine[] = [
    { kind: 'identifier', text: source.identifier.trim() },
  ]
  const lot = source.lot?.trim()
  if (lot) lines.push({ kind: 'lot', text: lot })
  const condition = source.condition?.trim()
  const useBy = source.useBy?.trim()
  if (condition && useBy) {
    lines.push({ kind: 'storage', text: `${condition} · use by ${useBy}` })
  } else if (useBy) {
    lines.push({ kind: 'storage', text: `use by ${useBy}` })
  } else if (condition) {
    lines.push({ kind: 'storage', text: condition })
  }
  return lines
}
