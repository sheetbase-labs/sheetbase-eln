import { Link } from '@tanstack/react-router'

import {
  PageHeader,
  DescriptionList,
  Inspector,
  InspectorSection,
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
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { LiveReadingsSection } from '#/components/instruments/live-readings'
import { CalibrationOverdueNotice } from '#/components/instruments/calibration-overdue'
import { IntakeDeliveryNotice } from '#/components/instruments/intake-delivery-notice'
import { ParserFollowUpNotice } from '#/components/instruments/parser-follow-up'
import { OutOfServiceNotice } from '#/components/instruments/out-of-service'
import {
  calibrationStatus,
  formatInstrumentDay,
  intakeDeliveryProblem,
  isOutOfService,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentCalibrationRow,
  InstrumentRow,
  InstrumentRunRow,
  ParserFollowUp,
} from '#/components/instruments/instruments-data'
import type { useInstrumentGateMode } from '#/lib/instrument-gate'
import type { ConnectorWire } from '#/lib/connectors/types'
import { instrumentTypeLabel } from '#/lib/instrument-type-label'
import { formatDate } from '#/lib/format-date'
import type { Tone } from '#/components/ui/status'
import { rich, t } from '#/copy'

/** How an instrument's health reads: a tone and the words for it. */
interface InstrumentStatus {
  tone: Tone
  label: string
}

/** One booking in the week the inspector lists. */
interface InstrumentWeekBooking {
  id: string
  title: string
  starts_at: string
  created_by_user_id: string | null
}

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

/** The instrument page's title, status meta and the actions it earns. */
export function InstrumentHeader({
  instrument,
  health,
  canRecord,
  canCalibrate,
  onServiceState,
  onRecordCalibration,
}: {
  instrument: InstrumentRow
  health: InstrumentStatus
  canRecord: boolean
  canCalibrate: boolean
  /** Mark out of service, or bring back in. */
  onServiceState: (down: boolean) => void
  onRecordCalibration: () => void
}) {
  const i = instrument
  const down = isOutOfService(i)

  return (
    <PageHeader
      trail={[
        {
          label: t('library.instruments.record.instruments'),
          link: { to: '/instruments' },
        },
        { label: i.displayId ?? i.id.slice(0, 8), mono: true },
      ]}
      title={i.name}
      meta={
        <>
          {down ? (
            <span className="text-fg">
              <Status tone="warn">
                {t('library.instruments.outOfService.status')}
              </Status>
            </span>
          ) : null}
          <span className="text-fg">
            <Status tone={health.tone}>{health.label}</Status>
          </span>
          <span>{instrumentTypeLabel(i.instrumentType)}</span>
          <span className="max-lg:hidden">{i.model ?? '—'}</span>
        </>
      }
      actions={
        <>
          <FavouriteToggle kind="instrument" objectId={i.id} />
          {canRecord ? (
            // Upload is on every instrument, not only one whose intake has
            // gone quiet: the import page opens with this instrument chosen.
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link to="/import" search={{ instrument: i.id }} />}
            >
              {t('common.actions.upload')}
            </Button>
          ) : null}
          {!i.retiredAt && !down ? (
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link to="/schedule" search={{ book: i.id }} />}
            >
              {t('library.instruments.record.book')}
            </Button>
          ) : null}
          {canCalibrate && !i.retiredAt ? (
            <Button variant="secondary" onClick={() => onServiceState(down)}>
              {down
                ? t('library.instruments.outOfService.backInService')
                : t('library.instruments.outOfService.markOutOfService')}
            </Button>
          ) : null}
          {canCalibrate ? (
            <Button variant="primary" icon="plus" onClick={onRecordCalibration}>
              {t('library.instruments.record.recordCalibration')}
            </Button>
          ) : null}
        </>
      }
    />
  )
}

/** The instrument's at-a-glance facts and its intake and calibration blocks. */
export function InstrumentSummary({
  instrument,
  health,
  lastDataAt,
  intakeItems,
  userLabel,
  connector,
  followUp,
  canSetUpIntake,
  canRecord,
  canEditSchemas,
  canCalibrate,
  latest,
  calibrationRows,
  calibrationColumns,
  gateMode,
  onSetUp,
  onRecordCalibration,
  children,
}: {
  instrument: InstrumentRow
  health: InstrumentStatus
  lastDataAt: string | null
  intakeItems: [React.ReactNode, React.ReactNode][]
  userLabel: (userId: string) => string
  connector: ConnectorWire | null
  followUp: ParserFollowUp | null
  canSetUpIntake: boolean
  canRecord: boolean
  canEditSchemas: boolean
  canCalibrate: boolean
  latest: InstrumentCalibrationRow | null
  calibrationRows: InstrumentCalibrationRow[]
  calibrationColumns: RegistryColumn<InstrumentCalibrationRow>[]
  gateMode: ReturnType<typeof useInstrumentGateMode>
  onSetUp: (step: 1 | 3) => void
  onRecordCalibration: () => void
  /** The further record sections, kept inside the record's scroll container. */
  children?: React.ReactNode
}) {
  const i = instrument
  const status = calibrationStatus(latest?.dueAt ?? null)
  const deliveryProblem = intakeDeliveryProblem(health.label)
  const down = isOutOfService(i)

  return (
    <div className="@container/record flex min-h-0 min-w-0 flex-1 flex-col gap-7 overflow-auto px-4 py-4 md:px-6 [&>*]:shrink-0">
      {down ? (
        <OutOfServiceNotice
          instrument={i}
          names={{ userLabel }}
          action={
            canCalibrate ? (
              <Button size="sm" onClick={() => onSetUp(1)}>
                {t('library.instruments.outOfService.backInService')}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <InstrumentFacts
        calibration={latest}
        status={status}
        health={health}
        lastDataAt={lastDataAt}
        ownerLabel={i.ownerId ? userLabel(i.ownerId) : '—'}
        location={i.location}
      />
      <LiveReadingsSection
        instrument={i}
        canSetUp={canSetUpIntake}
        canSetLimits={canCalibrate}
      />
      <div className="grid grid-cols-1 gap-x-16 gap-y-7 @5xl/record:grid-cols-[repeat(2,minmax(0,1fr))] [&>*]:min-w-0">
        <IntakeSection
          instrument={i}
          intakeItems={intakeItems}
          connector={connector}
          followUp={followUp}
          deliveryProblem={deliveryProblem}
          canSetUpIntake={canSetUpIntake}
          canRecord={canRecord}
          canEditSchemas={canEditSchemas}
          onSetUp={onSetUp}
        />
        <CalibrationSection
          instrument={i}
          status={status}
          latest={latest}
          calibrationRows={calibrationRows}
          calibrationColumns={calibrationColumns}
          gateMode={gateMode}
          canCalibrate={canCalibrate}
          onRecordCalibration={onRecordCalibration}
        />
      </div>
      {children}
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
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.record.runs')}
      count={rows.length}
    >
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

/** The right-hand inspector: calibration, the record itself and this week. */
export function InstrumentInspector({
  latest,
  instrument,
  userLabel,
  week,
}: {
  latest: InstrumentCalibrationRow | null
  instrument: InstrumentRow
  userLabel: (userId: string) => string
  week: InstrumentWeekBooking[]
}) {
  const i = instrument

  return (
    <Inspector
      aria-label={t('library.instruments.record.instrumentDetails')}
      className="w-[300px]"
    >
      <InspectorSection title={t('library.instruments.record.calibration')}>
        <DescriptionList
          labelWidth={70}
          items={[
            ['Last', formatInstrumentDay(latest?.performedAt)],
            ['Due', formatInstrumentDay(latest?.dueAt)],
          ]}
        />
      </InspectorSection>
      <InspectorSection title={t('library.instruments.record.record')}>
        <DescriptionList
          labelWidth={70}
          items={[
            ['ID', <span className="mono">{i.displayId ?? '—'}</span>],
            ['Created', formatInstrumentDay(i.createdAt)],
            ['By', i.createdByUserId ? userLabel(i.createdByUserId) : '—'],
          ]}
        />
      </InspectorSection>
      <InspectorSection
        title={t('library.instruments.record.bookingsThisWeek')}
      >
        {week.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
            {week.map((b) => (
              <li key={b.id}>
                {b.starts_at.slice(5, 10)} {b.starts_at.slice(11, 16)} ·{' '}
                {b.created_by_user_id
                  ? userLabel(b.created_by_user_id)
                  : b.title}
              </li>
            ))}
          </ul>
        ) : (
          <Muted>{t('library.instruments.record.noneInTheNextSeven')}</Muted>
        )}
      </InspectorSection>
    </Inspector>
  )
}

/** The five facts beside the instrument's name. */
function InstrumentFacts({
  calibration,
  status,
  health,
  lastDataAt,
  ownerLabel,
  location,
}: {
  calibration: InstrumentCalibrationRow | null
  status: InstrumentStatus
  health: InstrumentStatus
  lastDataAt: string | null
  ownerLabel: string
  location: string | null
}) {
  return (
    <dl className="m-0 flex flex-wrap gap-x-10 gap-y-3 pb-1">
      {[
        [
          t('library.instruments.record.calibration'),
          calibration ? (
            <Status tone={status.tone}>
              {status.label} · {formatInstrumentDay(calibration.dueAt)}
            </Status>
          ) : (
            t('library.instruments.record.notRecorded')
          ),
        ],
        [
          t('library.instruments.record.howDataGetsIn'),
          <Status tone={health.tone}>{health.label}</Status>,
        ],
        [
          t('library.instruments.record.lastData'),
          lastDataAt
            ? formatDate(lastDataAt, { time: true })
            : t('library.instruments.record.nothingReceived'),
        ],
        ['Owner', ownerLabel],
        ['Location', location ?? '—'],
      ].map(([k, v], n) => (
        <div key={n} className="flex flex-col gap-0.5">
          <dt className="text-label text-fg-muted">{k}</dt>
          <dd className="m-0 text-body font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** How data reaches this instrument, and what it waits on if it is stuck. */
function IntakeSection({
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
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.record.howDataGetsIn')}
    >
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

/** The calibration countdown, its overdue notice and the recorded history. */
function CalibrationSection({
  instrument,
  status,
  latest,
  calibrationRows,
  calibrationColumns,
  gateMode,
  canCalibrate,
  onRecordCalibration,
}: {
  instrument: InstrumentRow
  status: InstrumentStatus
  latest: InstrumentCalibrationRow | null
  calibrationRows: InstrumentCalibrationRow[]
  calibrationColumns: RegistryColumn<InstrumentCalibrationRow>[]
  gateMode: ReturnType<typeof useInstrumentGateMode>
  canCalibrate: boolean
  onRecordCalibration: () => void
}) {
  return (
    <Section
      className="border-t border-border pt-4"
      title={t('library.instruments.record.calibration')}
    >
      {status.label === 'Overdue' ? (
        <CalibrationOverdueNotice
          instrumentName={instrument.name}
          gateMode={gateMode}
          action={
            canCalibrate ? (
              <Button size="sm" onClick={onRecordCalibration}>
                {t('library.instruments.record.recordCalibration')}
              </Button>
            ) : undefined
          }
        />
      ) : null}
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
