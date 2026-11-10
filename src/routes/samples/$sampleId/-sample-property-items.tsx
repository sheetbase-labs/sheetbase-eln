import { formatSampleEventDateTime } from '#/components/samples/sample-history'
import { formatHoldDate } from '#/components/samples/sample-hold-data'
import type { RecordWire } from '#/lib/notebook-data'
import { t } from '#/copy'

import { formatVolume } from './-sample-details-data'
import { PurposeLink } from './-sample-purpose-link'

/** One property row: its label and the value the canonical reads gave it. */
export type PropertyItem = [React.ReactNode, React.ReactNode]

/** The design's Properties list, with the capsid titre's dataset provenance. */
export function samplePropertyItems({
  volume,
  capsid,
  created,
  purposes,
  sample,
}: {
  volume: {
    registered: number | null
    current: number | null
    unit: string | null
  }
  capsid:
    | {
        valueText: string | null
        value: number | null
        unit: string | null
        provenance: { datasetDisplayId: string | null }
      }
    | undefined
  created: { purposeRecordId: string | null; createdAt: string } | undefined
  purposes: Map<string, RecordWire> | undefined
  sample: { holdStartedAt: string | null }
}): PropertyItem[] {
  return [
    [
      t('library.samples.summary.registeredVolume'),
      formatVolume(volume.registered, volume.unit),
    ],
    [
      t('library.samples.summary.currentVolume'),
      <span className="font-medium">
        {formatVolume(volume.current, volume.unit)}
      </span>,
    ],
    [
      t('library.samples.summary.capsidTitre'),
      capsid ? (
        <span>
          {capsid.valueText ??
            (capsid.value != null
              ? capsid.value.toLocaleString('en-GB', {
                  maximumFractionDigits: 2,
                })
              : '—')}
          {capsid.unit ? ` ${capsid.unit}` : ''}
          {capsid.provenance.datasetDisplayId ? (
            <>
              {' · '}
              <span className="mono text-fg-muted">
                {capsid.provenance.datasetDisplayId}
              </span>
            </>
          ) : null}
        </span>
      ) : (
        '—'
      ),
    ],
    [t('library.samples.summary.cellLine'), '—'],
    [
      t('library.samples.summary.producedIn'),
      <PurposeLink
        key="produced"
        recordId={created?.purposeRecordId}
        purposes={purposes}
      />,
    ],
    [
      t('library.samples.summary.harvested'),
      created
        ? formatSampleEventDateTime(created.createdAt)
        : sample.holdStartedAt
          ? formatHoldDate(new Date(sample.holdStartedAt))
          : '—',
    ],
  ]
}

/** The design's Storage and release list. */
export function sampleStorageItems({
  sample,
  holdLimit,
  releaseChecks,
}: {
  sample: {
    storageLocation: string | null
    holdCondition: string | null
    releasedAt: string | null
  }
  holdLimit: string
  releaseChecks: string
}): PropertyItem[] {
  return [
    [t('library.samples.summary.location'), sample.storageLocation ?? '—'],
    [t('library.samples.summary.condition'), sample.holdCondition ?? '—'],
    [t('library.samples.summary.holdLimit'), holdLimit],
    [
      t('library.samples.summary.released'),
      sample.releasedAt ? formatHoldDate(new Date(sample.releasedAt)) : '—',
    ],
    [t('library.samples.summary.releaseBasis'), releaseChecks],
  ]
}
