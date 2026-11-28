import { Link } from '@tanstack/react-router'

import {
  PageHeader,
  DescriptionList,
  Muted,
  Section,
} from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { TableBox } from '#/components/ui/table'
import { RecordUnavailable } from '#/components/ui/record-unavailable'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { IntakeDeliveryNotice } from '#/components/instruments/intake-delivery-notice'
import { ParserFollowUpNotice } from '#/components/instruments/parser-follow-up'
import {
  calibrationStatus,
  formatInstrumentDay,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentRow,
  InstrumentRunRow,
  ParserFollowUp,
} from '#/components/instruments/instruments-data'
import type { ConnectorWire } from '#/lib/connectors/types'
import { rich, t } from '#/copy'

/** The not-found frame: the crumb, a title that says which state, and why. */
export function InstrumentUnavailable({
  query,
  loading,
}: {
  query: Parameters<typeof RecordUnavailable>[0]['query']
  loading: boolean
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          {
            label: t('library.instruments.record.instruments'),
            link: { to: '/instruments' },
          },
        ]}
        title={
          loading
            ? t('library.instruments.record.loadingInstrument')
            : t('library.instruments.record.instrumentNotFound')
        }
      />
      <RecordUnavailable
        query={query}
        what={t('settings.uiKit.recordUnavailable.instrument')}
        back={{
          to: '/instruments',
          label: t('settings.uiKit.recordUnavailable.backToInstruments'),
        }}
      />
    </div>
  )
}

/** The runs the instrument has produced, or the note that none has yet. */
export function RunsSection({
  rows,
  runColumns,
}: {
  rows: InstrumentRunRow[]
  runColumns: RegistryColumn<InstrumentRunRow>[]
}) {
  return (
    <Section title={t('library.instruments.record.runs')} count={rows.length}>
      {rows.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.instruments.record.instrumentRuns')}
            rows={rows}
            columns={runColumns}
            getRowId={(r) => r.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          icon="pipeline"
          title={t('library.instruments.record.noRunsYet')}
          description={t(
            'library.instruments.record.runsArriveFromTheInstrument',
          )}
          className="py-4"
        />
      )}
    </Section>
  )
}

/** How data reaches this instrument, and what it waits on if it is stuck. */
export function IntakeSection({
  instrument,
  intakeItems,
  connector,
  followUp,
  deliveryProblem,
  canSetUpIntake,
  canRecord,
  canEditSchemas,
  onSetUp,
}: {
  instrument: InstrumentRow
  intakeItems: [React.ReactNode, React.ReactNode][]
  connector: ConnectorWire | null
  followUp: ParserFollowUp | null
  deliveryProblem: 'failed' | 'stale' | 'waiting' | null
  canSetUpIntake: boolean
  canRecord: boolean
  canEditSchemas: boolean
  onSetUp: (step: 1 | 3) => void
}) {
  const i = instrument

  return (
    <Section title={t('library.instruments.record.howDataGetsIn')}>
      <DescriptionList labelWidth={130} items={intakeItems} />
      {canSetUpIntake && !i.retiredAt ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onSetUp(1)}>
            {connector
              ? t('library.instruments.intakeStatus.change')
              : t('library.instruments.intakeStatus.setUp')}
          </Button>
          {connector ? (
            <Button size="sm" onClick={() => onSetUp(3)}>
              {t('library.instruments.agent.download')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {followUp ? (
        <ParserFollowUpNotice
          instrumentName={i.name}
          followUp={followUp}
          canEdit={canEditSchemas}
        />
      ) : deliveryProblem ? (
        <IntakeDeliveryNotice
          instrumentId={i.id}
          instrumentName={i.name}
          problem={deliveryProblem}
          canImport={canRecord}
          onSetUp={canSetUpIntake && !connector ? () => onSetUp(1) : undefined}
        />
      ) : (
        <Muted className="mt-1.5">
          {rich('library.instruments.record.howDataGetsInIs', {
            link: (text) => (
              <Link
                to="/instruments"
                search={{ selected: i.id }}
                className="text-link hover:underline"
              >
                {text}
              </Link>
            ),
          })}
        </Muted>
      )}
    </Section>
  )
}

/**
 * The calibration tab: where it stands, Record calibration, and every one
 * recorded. An overdue calibration is the page's state line, not a notice
 * here.
 */
export function CalibrationSection({
  latest,
  calibrationRows,
  calibrationColumns,
  canCalibrate,
  onRecordCalibration,
}: {
  latest: InstrumentCalibrationRow | null
  calibrationRows: InstrumentCalibrationRow[]
  calibrationColumns: RegistryColumn<InstrumentCalibrationRow>[]
  canCalibrate: boolean
  onRecordCalibration: () => void
}) {
  const status = calibrationStatus(latest?.dueAt ?? null)

  return (
    <Section
      title={t('library.instruments.record.calibration')}
      action={
        canCalibrate ? (
          <Button size="sm" icon="plus" onClick={onRecordCalibration}>
            {t('library.instruments.record.recordCalibration')}
          </Button>
        ) : null
      }
    >
      <DescriptionList
        labelWidth={130}
        items={[
          [
            'Status',
            <Status key="s" tone={status.tone}>
              {status.label}
            </Status>,
          ],
          [
            t('library.instruments.record.lastPerformed'),
            formatInstrumentDay(latest?.performedAt),
          ],
          [
            t('library.instruments.record.nextDue'),
            formatInstrumentDay(latest?.dueAt),
          ],
        ]}
      />
      {calibrationRows.length ? (
        <TableBox>
          <RegistryGrid
            label={t('library.instruments.record.calibrationHistory')}
            rows={calibrationRows}
            columns={calibrationColumns}
            getRowId={(c) => c.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <Muted>
          {t('library.instruments.record.noCalibrationRecordedInstrumentsWith')}
        </Muted>
      )}
    </Section>
  )
}
