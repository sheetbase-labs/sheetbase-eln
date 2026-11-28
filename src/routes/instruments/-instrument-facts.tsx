/** The four facts the instrument's header shows beside its ID and health. */
import {
  calibrationStatus,
  formatInstrumentDay,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentRow,
} from '#/components/instruments/instruments-data'
import type { RecordFact } from '#/components/record-page/record-page'
import { Status } from '#/components/ui/status'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'

/** Calibration, last data, owner and location: the four the header shows. */
export function instrumentFacts({
  instrument,
  latest,
  lastDataAt,
  userLabel,
}: {
  instrument: InstrumentRow
  latest: InstrumentCalibrationRow | null
  lastDataAt: string | null
  userLabel: (userId: string) => string
}): RecordFact[] {
  const status = calibrationStatus(latest?.dueAt ?? null)

  return [
    {
      label: t('library.instruments.record.calibration'),
      value: latest ? (
        <Status tone={status.tone}>
          {status.label} · {formatInstrumentDay(latest.dueAt)}
        </Status>
      ) : (
        t('library.instruments.record.notRecorded')
      ),
    },
    {
      label: t('library.instruments.record.lastData'),
      value: lastDataAt
        ? formatDate(lastDataAt, { time: true })
        : t('library.instruments.record.nothingReceived'),
    },
    {
      label: t('library.instruments.record.ownerFact'),
      value: instrument.ownerId ? userLabel(instrument.ownerId) : '—',
    },
    {
      label: t('library.instruments.record.locationFact'),
      value: instrument.location ?? '—',
    },
  ]
}
