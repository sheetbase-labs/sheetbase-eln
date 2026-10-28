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
    showLot: z.boolean().default(true),
    showSampleType: z.boolean().default(false),
    widthMm: z.number().int().min(10).max(200).default(50),
    heightMm: z.number().int().min(10).max(200).default(25),
    barcodeType: z.enum(['qr', 'code128']).default('qr'),
    isDefault: z.boolean().default(false),
    archivedAt: z.string().nullable().default(null),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()

export type LabelTemplate = z.infer<typeof labelTemplateSchema>
export type BarcodeType = LabelTemplate['barcodeType']

export const BARCODE_TYPE_LABELS: Record<BarcodeType, string> = {
  qr: 'QR code',
  code128: 'Barcode (Code 128)',
}

/** What a label prints when no template has been chosen. */
export const DEFAULT_LABEL_TEMPLATE: Pick<
  LabelTemplate,
  | 'showCondition'
  | 'showUseBy'
  | 'showLot'
  | 'showSampleType'
  | 'widthMm'
  | 'heightMm'
  | 'barcodeType'
> = {
  showCondition: true,
  showUseBy: true,
  showLot: true,
  showSampleType: false,
  widthMm: 50,
  heightMm: 25,
  barcodeType: 'qr',
}

/** A label_templates row as PostgREST returns it. */
export function labelTemplateFromRow(
  row: Record<string, unknown>,
): LabelTemplate {
  return parseLabelTemplate({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    recordKind: row.record_kind,
    showCondition: row.show_condition,
    showUseBy: row.show_use_by,
    showLot: row.show_lot,
    showSampleType: row.show_sample_type,
    widthMm: row.width_mm,
    heightMm: row.height_mm,
    barcodeType: row.barcode_type,
    isDefault: row.is_default,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

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
  sampleType?: string | null
  condition?: string | null
  useBy?: string | null
}

export interface LabelLine {
  /** Which fact the line carries, so a caller can label or hide it. */
  kind: 'identifier' | 'type' | 'lot' | 'storage'
  text: string
}

/**
 * The label's machine lines. The storage line carries the condition and the use-by
 * date together only when both are known; a date with no condition still prints,
 * because the date alone is the operative fact on a bench.
 */
export function buildLabelLines(
  source: LabelSource,
  show: Partial<
    Pick<
      LabelTemplate,
      'showLot' | 'showSampleType' | 'showCondition' | 'showUseBy'
    >
  > = {},
): LabelLine[] {
  const {
    showLot = true,
    showSampleType = false,
    showCondition = true,
    showUseBy = true,
  } = show
  const lines: LabelLine[] = [
    { kind: 'identifier', text: source.identifier.trim() },
  ]
  const sampleType = source.sampleType?.trim()
  if (showSampleType && sampleType) {
    lines.push({ kind: 'type', text: sampleType })
  }
  const lot = source.lot?.trim()
  if (showLot && lot) lines.push({ kind: 'lot', text: lot })
  const condition = showCondition ? source.condition?.trim() : undefined
  const useBy = showUseBy ? source.useBy?.trim() : undefined
  if (condition && useBy) {
    lines.push({ kind: 'storage', text: `${condition} · use by ${useBy}` })
  } else if (useBy) {
    lines.push({ kind: 'storage', text: `use by ${useBy}` })
  } else if (condition) {
    lines.push({ kind: 'storage', text: condition })
  }
  return lines
}
