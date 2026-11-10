import QRCode from 'qrcode'
import { z } from 'zod'

import { encodeCode128, isCode128Text } from '#/lib/barcode128'
import { isPluginItem, labelQrPayload } from '#/lib/labels'
import type { LabelSource, LabelTemplate } from '#/lib/labels'
import type { PluginBarcodeDrawing } from '#/lib/extensions/plugin-files'
import type { RecordWire } from '#/lib/notebook-data'
import { computeSampleHold, formatHoldDateShort } from './sample-hold-data'

export interface SampleLabelRecord {
  identifier: string
  title?: string | null
  sampleType?: string | null
  barcode?: string | null
  createdAt?: string
  properties?: RecordWire['properties']
  customFields?: RecordWire['custom_fields']
}

export type LabelLook = Partial<
  Pick<
    LabelTemplate,
    | 'showCondition'
    | 'showUseBy'
    | 'showLot'
    | 'showSampleType'
    | 'widthMm'
    | 'heightMm'
    | 'barcodeType'
    | 'layout'
  >
>

function qrPath(payload: string) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const data = qr.modules.data
  let d = ''

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`
    }
  }

  return { d, size }
}

function modulesPath(bits: string) {
  let d = ''

  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] === '1') d += `M${i} 0h1v1h-1z`
  }

  return { d, modules: bits.length }
}

function gridPath(rows: readonly string[]) {
  let d = ''
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] === '1') d += `M${x} ${y}h1v1h-1z`
    }
  })

  return { d, size: Math.max(rows.length, rows[0]?.length ?? 0) }
}

function barcodePath(text: string) {
  return isCode128Text(text) ? modulesPath(encodeCode128(text)) : null
}

export function labelCodeDrawing({
  host,
  identifier,
  barcodeType,
  pluginCode,
}: {
  host: string
  identifier: string
  barcodeType: string
  pluginCode: PluginBarcodeDrawing | undefined
}) {
  const payload = host ? labelQrPayload(host, identifier) : null
  const pluginCodePending = isPluginItem(barcodeType) && !pluginCode
  const isBarcode = barcodeType === 'code128' || pluginCode?.kind === 'bars'
  const plain = !isPluginItem(barcodeType)

  const code =
    plain && !isBarcode && payload
      ? qrPath(payload)
      : pluginCode?.kind === 'grid'
        ? gridPath(pluginCode.rows)
        : null

  const bars =
    pluginCode?.kind === 'bars'
      ? modulesPath(pluginCode.modules)
      : plain && isBarcode
        ? barcodePath(identifier.trim())
        : null

  return { payload, pluginCodePending, isBarcode, code, bars }
}

/** CSS pixels in a millimetre on a 96 dpi screen. */
const PX_PER_MM = 96 / 25.4

export function labelDimensions(
  look: Pick<LabelTemplate, 'widthMm' | 'heightMm'>,
  fit: 'natural' | 'mm' | number,
) {
  const ppm = fit === 'mm' ? PX_PER_MM : fit === 'natural' ? null : fit

  const style =
    fit === 'mm'
      ? { width: `${look.widthMm}mm`, height: `${look.heightMm}mm` }
      : ppm
        ? { width: look.widthMm * ppm, height: look.heightMm * ppm }
        : undefined

  const sized = ppm !== null
  const pad = sized ? 5 : 10

  const codePx = ppm
    ? Math.max(16, Math.min(56, Math.round(look.heightMm * ppm - 2 * pad)))
    : 56

  const barsPx = ppm
    ? Math.max(12, Math.min(40, Math.round(look.heightMm * ppm * 0.36)))
    : 36

  const pictogramPx = ppm
    ? Math.max(
        12,
        Math.min(28, Math.round((look.heightMm * ppm - 2 * pad) / 2)),
      )
    : 28

  return { style, sized, pad, codePx, barsPx, pictogramPx }
}

function batchOf(record: SampleLabelRecord): string | null {
  const batch = z.string().safeParse(record.customFields?.batch)

  return batch.success && batch.data.trim() !== '' ? batch.data : null
}

export function labelFacts(
  record: SampleLabelRecord,
  source: Omit<LabelSource, 'identifier'> | undefined,
): LabelSource {
  if (source) return { identifier: record.identifier, ...source }

  const hold = computeSampleHold({
    createdAt: record.createdAt ?? new Date().toISOString(),
    properties: record.properties,
    customFields: record.customFields,
  })

  return {
    identifier: record.identifier,
    sampleType: record.sampleType,
    lot: batchOf(record),
    condition: hold?.condition ?? null,
    useBy: hold ? formatHoldDateShort(hold.expiry) : null,
  }
}
