/**
 * What the instrument's record page says above its tabs: Book as the one main
 * action with the rest under ⋯, and the one state
 * line (out of service, else an overdue calibration).
 */
import { Link } from '@tanstack/react-router'

import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import {
  calibrationStatus,
  formatInstrumentDay,
  isOutOfService,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentRow,
} from '#/components/instruments/instruments-data'
import { RecordStateLine } from '#/components/record-page/record-state-line'
import { Button } from '#/components/ui/button'
import { DropdownMenuItem } from '#/components/ui/dropdown-menu'
import type { InstrumentGateMode } from '#/lib/workspace-admin'
import { t } from '#/copy'

/** Favourite, then Book while the instrument can be booked. */
export function InstrumentActions({
  instrument,
}: {
  instrument: InstrumentRow
}) {
  const bookable = !instrument.retiredAt && !isOutOfService(instrument)

  return (
    <>
      <FavouriteToggle kind="instrument" objectId={instrument.id} />
      {bookable ? (
        <Button
          variant="primary"
          nativeButton={false}
          render={<Link to="/schedule" search={{ book: instrument.id }} />}
        >
          {t('library.instruments.record.book')}
        </Button>
      ) : null}
    </>
  )
}

/** Everything else a person may do, under ⋯. */
export function InstrumentMoreItems({
  instrument,
  canRecord,
  canCalibrate,
  onRecordCalibration,
  onServiceState,
}: {
  instrument: InstrumentRow
  canRecord: boolean
  canCalibrate: boolean
  onRecordCalibration: () => void
  /** Mark out of service, or bring back in. */
  onServiceState: (down: boolean) => void
}) {
  const down = isOutOfService(instrument)

  return (
    <>
      {canCalibrate ? (
        <DropdownMenuItem icon="plus" onClick={onRecordCalibration}>
          {t('library.instruments.record.recordCalibration')}
        </DropdownMenuItem>
      ) : null}
      {canRecord ? (
        // Upload is on every instrument, not only one whose intake has gone
        // quiet: the import page opens with this instrument chosen.
        <DropdownMenuItem
          icon="upload"
          render={<Link to="/import" search={{ instrument: instrument.id }} />}
        >
          {t('common.actions.upload')}
        </DropdownMenuItem>
      ) : null}
      {canCalibrate && !instrument.retiredAt ? (
        <DropdownMenuItem danger={!down} onClick={() => onServiceState(down)}>
          {down
            ? t('library.instruments.outOfService.backInService')
            : t('library.instruments.outOfService.markOutOfService')}
        </DropdownMenuItem>
      ) : null}
    </>
  )
}

/**
 * Out of service says since when, why and when it is back; otherwise an
 * overdue calibration says what it stops. An instrument in good standing has
 * no line.
 */
export function InstrumentStateLine({
  instrument,
  latest,
  gateMode,
  canCalibrate,
  userLabel,
  onBackInService,
  onRecordCalibration,
}: {
  instrument: InstrumentRow
  latest: InstrumentCalibrationRow | null
  gateMode: InstrumentGateMode
  canCalibrate: boolean
  userLabel: (userId: string) => string
  onBackInService: () => void
  onRecordCalibration: () => void
}) {
  if (isOutOfService(instrument)) {
    const detail = [
      instrument.outOfServiceReason,
      instrument.expectedBackOn
        ? t('library.instruments.outOfService.expectedBack', {
            date: formatInstrumentDay(instrument.expectedBackOn),
          })
        : null,
      instrument.outOfServiceBy
        ? t('library.instruments.outOfService.markedBy', {
            name: userLabel(instrument.outOfServiceBy),
          })
        : null,
    ]
      .filter(Boolean)
      .join(' · ')

    return (
      <RecordStateLine
        tone="warn"
        action={
          canCalibrate ? (
            <Button size="sm" onClick={onBackInService}>
              {t('library.instruments.outOfService.backInService')}
            </Button>
          ) : null
        }
      >
        {t('library.instruments.outOfService.since', {
          date: formatInstrumentDay(instrument.outOfServiceAt),
        })}{' '}
        {detail}
      </RecordStateLine>
    )
  }

  if (calibrationStatus(latest?.dueAt ?? null).label !== 'Overdue') return null

  const instrumentName = instrument.name

  return (
    <RecordStateLine
      tone="bad"
      action={
        canCalibrate ? (
          <Button size="sm" onClick={onRecordCalibration}>
            {t('library.instruments.record.recordCalibration')}
          </Button>
        ) : null
      }
    >
      {t('library.instruments.calibrationOverdue.calibrationOverdue')}{' '}
      {gateMode === 'block'
        ? t('library.instruments.calibrationOverdue.dataRefused', {
            instrumentName,
          })
        : gateMode === 'warn'
          ? t('library.instruments.calibrationOverdue.dataFlagged', {
              instrumentName,
            })
          : t('library.instruments.calibrationOverdue.notBookable', {
              instrumentName,
            })}
      {canCalibrate
        ? null
        : t('library.instruments.calibrationOverdue.askAWorkspaceMemberWith')}
    </RecordStateLine>
  )
}
