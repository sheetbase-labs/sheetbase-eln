import { computeSampleHold, formatHoldDateShort } from './sample-hold-meter'

/**
 * LAB-03 — the sample inspector's label card (SampleDetail / SampleLineage /
 * SampleUsage).
 *
 * The design's label preview is a data-matrix code with three machine lines:
 * the stable identifier, the lot (`batch` custom field) and the storage
 * condition with the hold use-by date. The condition and use-by date come from
 * the stored hold window (LAB-02); when a sample carries no hold window the
 * line is omitted rather than fabricated. The data-matrix is the design's fixed
 * pattern (LAB-05 owns the scannable template); this is the inspector preview.
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

export function SampleLabelCard({ record }: { record: SampleLabelRecord }) {
  const batch = batchOf(record)
  const hold = computeSampleHold({
    createdAt: record.createdAt ?? new Date().toISOString(),
    properties: record.properties,
    customFields: record.customFields,
  })
  const storageLine =
    hold && hold.condition
      ? `${hold.condition} · use by ${formatHoldDateShort(hold.expiry)}`
      : hold
        ? `use by ${formatHoldDateShort(hold.expiry)}`
        : null
  return (
    <div
      data-slot="sample-label"
      role="group"
      aria-label={`Printable label for ${record.identifier}`}
      className="grid grid-cols-[56px_1fr] items-center gap-2.5 rounded-sm border border-border p-2.5"
    >
      <svg
        width="56"
        height="56"
        viewBox="0 0 7 7"
        role="img"
        aria-label={`Label barcode for ${record.identifier}`}
        shapeRendering="crispEdges"
      >
        <path
          d="M0 0h3v3H0zM4 0h3v3H4zM0 4h3v3H0zM4 4h1v1H4zM6 4h1v1H6zM5 5h1v1H5zM4 6h1v1H4zM6 6h1v1H6z"
          fill="currentColor"
        />
        <path
          d="M1 1h1v1H1zM5 1h1v1H5zM1 5h1v1H1z"
          style={{ fill: 'var(--surface)' }}
        />
      </svg>
      <div className="mono text-[11px] leading-4">
        <div>{record.identifier}</div>
        {batch ? <div>{batch}</div> : null}
        {storageLine ? <div>{storageLine}</div> : null}
      </div>
    </div>
  )
}
