import QRCode from 'qrcode'

import { buildLabelLines, labelQrPayload } from '#/lib/labels'

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

export function SampleLabelCard({
  record,
  host,
}: {
  record: SampleLabelRecord
  /** The host a scanned code resolves against; defaults to the current origin. */
  host?: string
}) {
  const resolvedHost =
    host ?? (typeof window !== 'undefined' ? window.location.host : '')
  const batch = batchOf(record)
  const hold = computeSampleHold({
    createdAt: record.createdAt ?? new Date().toISOString(),
    properties: record.properties,
    customFields: record.customFields,
  })
  const lines = buildLabelLines({
    identifier: record.identifier,
    lot: batch,
    condition: hold?.condition ?? null,
    useBy: hold ? formatHoldDateShort(hold.expiry) : null,
  })
  const payload = resolvedHost
    ? labelQrPayload(resolvedHost, record.identifier)
    : null
  const code = payload ? qrPath(payload) : null

  return (
    <div
      data-slot="sample-label"
      role="group"
      aria-label={`Printable label for ${record.identifier}`}
      className="grid grid-cols-[56px_1fr] items-center gap-2.5 rounded-sm border border-border p-2.5"
    >
      {code && payload ? (
        <svg
          width="56"
          height="56"
          viewBox={`0 0 ${code.size} ${code.size}`}
          role="img"
          aria-label={`Label code resolving to ${payload}`}
          shapeRendering="crispEdges"
        >
          <path d={code.d} fill="currentColor" />
        </svg>
      ) : (
        <span
          className="flex size-14 items-center justify-center border border-dashed border-border-strong text-[9px] leading-3 text-fg-muted"
          role="status"
        >
          No code
        </span>
      )}
      <div className="mono text-[11px] leading-4">
        {lines.map((line) => (
          <div key={line.kind}>{line.text}</div>
        ))}
      </div>
    </div>
  )
}
