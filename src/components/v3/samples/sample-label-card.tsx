import QRCode from 'qrcode'

import { encodeCode128, isCode128Text } from '#/lib/barcode128'
import {
  DEFAULT_LABEL_TEMPLATE,
  buildLabelLines,
  labelQrPayload,
} from '#/lib/labels'
import type { LabelTemplate } from '#/lib/labels'

import { computeSampleHold, formatHoldDateShort } from './sample-hold-meter'

/**
 * LAB-05.1 — the sample inspector's label preview (SampleDetail / SampleLineage /
 * SampleUsage).
 *
 * The code is a real, scannable QR of the DEC-10 payload
 * `https://<host>/r/<identifier>`, so a printed label resolves through the resolver
 * route. It replaced a fixed decorative pattern that could not be scanned.
 *
 * The lines are the identifier, the lot (`batch` custom field) and the storage
 * condition with the hold use-by date (LAB-02). A line is omitted when the sample does
 * not carry the fact rather than being fabricated. Without a host there is no honest
 * payload to encode, so the card says so instead of drawing a code that would resolve
 * nowhere.
 */
export interface SampleLabelRecord {
  identifier: string
  title?: string | null
  sampleType?: string | null
  barcode?: string | null
  createdAt?: string
  properties?: Record<string, unknown> | null
  customFields?: Record<string, unknown> | null
}

function batchOf(record: SampleLabelRecord): string | null {
  const batch = record.customFields?.batch
  return typeof batch === 'string' && batch.trim() !== '' ? batch : null
}

/** The QR modules as one SVG path; synchronous, so the card needs no effect. */
function qrPath(payload: string): { d: string; size: number } {
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

/** The parts of a label template that decide how a label looks. */
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
  >
>

/** The Code 128 bars as one SVG path, one module wide each. */
function barcodePath(text: string): { d: string; modules: number } | null {
  if (!isCode128Text(text)) return null
  const bits = encodeCode128(text)
  let d = ''
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] === '1') d += `M${i} 0h1v1h-1z`
  }
  return { d, modules: bits.length }
}

export function SampleLabelCard({
  record,
  host,
  template,
  fit = 'natural',
}: {
  record: SampleLabelRecord
  /** The host a scanned code resolves against; defaults to the current origin. */
  host?: string
  /** What the label carries and how it is sized; the default template when omitted. */
  template?: LabelLook
  /**
   * `natural` sizes the card to its content, `mm` to the template's real size
   * (for printing), and a number draws it at that many pixels per millimetre.
   */
  fit?: 'natural' | 'mm' | number
}) {
  const look = { ...DEFAULT_LABEL_TEMPLATE, ...template }
  const resolvedHost =
    host ?? (typeof window !== 'undefined' ? window.location.host : '')
  const batch = batchOf(record)
  const hold = computeSampleHold({
    createdAt: record.createdAt ?? new Date().toISOString(),
    properties: record.properties,
    customFields: record.customFields,
  })
  const lines = buildLabelLines(
    {
      identifier: record.identifier,
      sampleType: record.sampleType,
      lot: batch,
      condition: hold?.condition ?? null,
      useBy: hold ? formatHoldDateShort(hold.expiry) : null,
    },
    look,
  )
  const payload = resolvedHost
    ? labelQrPayload(resolvedHost, record.identifier)
    : null
  const isBarcode = look.barcodeType === 'code128'
  const code = !isBarcode && payload ? qrPath(payload) : null
  const bars = isBarcode ? barcodePath(record.identifier.trim()) : null
  const style =
    fit === 'mm'
      ? { width: `${look.widthMm}mm`, height: `${look.heightMm}mm` }
      : typeof fit === 'number'
        ? { width: look.widthMm * fit, height: look.heightMm * fit }
        : undefined
  const sized = style !== undefined

  const lineBlock = (
    <div className="mono min-w-0 text-[11px] leading-4">
      {lines.map((line) => (
        <div key={line.kind} className={sized ? 'truncate' : undefined}>
          {line.text}
        </div>
      ))}
    </div>
  )
  return (
    <div
      data-slot="sample-label"
      role="group"
      aria-label={`Printable label for ${record.identifier}`}
      style={style}
      className={
        isBarcode
          ? 'box-border flex flex-col justify-center gap-1.5 overflow-hidden rounded-sm border border-border p-2.5'
          : 'box-border grid grid-cols-[auto_1fr] items-center gap-2.5 overflow-hidden rounded-sm border border-border p-2.5'
      }
    >
      {bars ? (
        <svg
          className="h-9 w-full"
          viewBox={`0 0 ${bars.modules} 1`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Barcode for ${record.identifier}`}
          shapeRendering="crispEdges"
        >
          <path d={bars.d} fill="currentColor" />
        </svg>
      ) : isBarcode ? (
        <span
          className="flex h-9 items-center justify-center border border-dashed border-border-strong text-[9px] leading-3 text-fg-muted"
          role="status"
        >
          No barcode
        </span>
      ) : code && payload ? (
        <svg
          className="size-14 shrink-0"
          viewBox={`0 0 ${code.size} ${code.size}`}
          role="img"
          aria-label={`Label code resolving to ${payload}`}
          shapeRendering="crispEdges"
        >
          <path d={code.d} fill="currentColor" />
        </svg>
      ) : (
        <span
          className="flex size-14 shrink-0 items-center justify-center border border-dashed border-border-strong text-[9px] leading-3 text-fg-muted"
          role="status"
        >
          No code
        </span>
      )}
      {lineBlock}
    </div>
  )
}
