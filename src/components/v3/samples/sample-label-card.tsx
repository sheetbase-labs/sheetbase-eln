import { Icon } from '#/components/v3/icons'

/**
 * LAB-03 / step 4 — the sample inspector's label card (SampleDetail).
 *
 * This is a printable label representation built entirely from stored sample
 * fields: the stable identifier, lot (the `batch` custom field when present),
 * sample type and barcode. The design also prints a storage condition and a
 * use-by date; those are not modelled on a sample (see LAB-02 / the hold-time
 * gap) so they are omitted rather than fabricated. The scannable 2D code is
 * LAB-05's label template; this card is the inspector preview of the fields a
 * label would carry.
 */
export interface SampleLabelRecord {
  identifier: string
  title?: string | null
  sampleType?: string | null
  barcode?: string | null
  customFields?: Record<string, unknown> | null
}

function batchOf(record: SampleLabelRecord): string | null {
  const batch = record.customFields?.batch
  return typeof batch === 'string' && batch.trim() !== '' ? batch : null
}

export function SampleLabelCard({ record }: { record: SampleLabelRecord }) {
  const batch = batchOf(record)
  const scanValue = record.barcode?.trim() ? record.barcode.trim() : null
  return (
    <div
      data-slot="sample-label"
      role="group"
      aria-label={`Printable label for ${record.identifier}`}
      className="grid grid-cols-[56px_1fr] items-center gap-2.5 rounded-sm border border-border p-2.5"
    >
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-sm border border-border-subtle bg-surface-muted text-fg-muted"
      >
        <Icon name="tube" size={24} />
      </span>
      <div className="mono text-[11px] leading-4">
        <div className="font-medium">{record.identifier}</div>
        {batch ? <div>{batch}</div> : null}
        {record.sampleType ? (
          <div className="text-fg-muted">{record.sampleType}</div>
        ) : null}
        <div className="text-fg-muted">
          {scanValue ? `Barcode ${scanValue}` : 'Barcode not set'}
        </div>
      </div>
    </div>
  )
}
