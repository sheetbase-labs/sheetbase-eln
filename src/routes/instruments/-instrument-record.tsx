import { IntakeProblems } from '#/components/integrations/intake-problems'
import { ServiceLogSection } from '#/components/instruments/out-of-service'
import { BookingRulesSection } from '#/components/instruments/booking-rules'
import { InstrumentRateSection } from '#/components/facility/instrument-rate'
import { IntakeSetupDialog } from '#/components/instruments/intake-setup-dialog'
import { ConvertedDataSection } from '#/components/instruments/converted-data'
import { InstrumentTimeline } from '#/components/scheduler/instrument-timeline'
import { RobotSection } from '#/components/instruments/robot-section'
import { RunQcPanel } from '#/components/quality/run-qc-panel'
import { LiveReadingsSection } from '#/components/instruments/live-readings'
import {
  intakeDeliveryProblem,
  isOutOfService,
} from '#/components/instruments/instruments-data'
import { RecordPage } from '#/components/record-page/record-page'
import { t } from '#/copy'
import type {
  InstrumentCalibrationRow,
  InstrumentRow,
  InstrumentRunRow,
} from '#/components/instruments/instruments-data'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import type { useInstrumentGateMode } from '#/lib/instrument-gate'
import type { ConnectorWire } from '#/lib/connectors/types'

import type { QualificationRow } from './-instrument-columns'
import { InstrumentDialogs } from './-instrument-dialogs'
import { HistorySection, UsedBySection } from './-instrument-fields'
import { instrumentFacts } from './-instrument-facts'
import {
  InstrumentActions,
  InstrumentMoreItems,
  InstrumentStateLine,
} from './-instrument-header'
import type { useInstrumentMutations } from './-instrument-mutations'
import { QualificationSection } from './-instrument-qualification'
import {
  CalibrationSection,
  IntakeSection,
  RunsSection,
} from './-instrument-sections'
import { InstrumentSidePanel } from './-instrument-side'
import type { InstrumentWeekBooking } from './-instrument-side'
import { instrumentTabOf } from './-instrument-page-state'
import type {
  InstrumentTab,
  useInstrumentPageState,
} from './-instrument-page-state'
import type { instrumentIntake } from './-instrument-summary-data'

/**
 * The instrument record once its reads have answered, on the shared record
 * page: Details (how data gets in, who may run it), Bookings, Calibration,
 * Service, Data and History, with its other fields in the side panel.
 */
export function InstrumentRecord({
  instrument,
  intake,
  names,
  page,
  mutations,
  canRecord,
  canCalibrate,
  canQualify,
  canSetUpIntake,
  canEditSchemas,
  canManageInstruments,
  workspaceId,
  gateMode,
  latest,
  calibrationRows,
  calibrationColumns,
  runColumns,
  rows,
  usedByRows,
  historyEntries,
  weekRows,
  connector,
  qualificationsStatus,
  qualifierError,
  qualificationRows,
  qualificationColumns,
  scope,
  iAmQualified,
  iHaveAsked,
  requestRows,
  projectOptions,
  members,
  membersError,
  onRequested,
}: {
  instrument: InstrumentRow
  intake: ReturnType<typeof instrumentIntake>
  names: { userLabel: (userId: string) => string }
  page: ReturnType<typeof useInstrumentPageState>
  mutations: ReturnType<typeof useInstrumentMutations>
  canRecord: boolean
  canCalibrate: boolean
  canQualify: boolean
  canSetUpIntake: boolean
  canEditSchemas: boolean
  canManageInstruments: boolean
  workspaceId: string
  gateMode: ReturnType<typeof useInstrumentGateMode>
  latest: InstrumentCalibrationRow | null
  calibrationRows: InstrumentCalibrationRow[]
  calibrationColumns: RegistryColumn<InstrumentCalibrationRow>[]
  runColumns: RegistryColumn<InstrumentRunRow>[]
  rows: InstrumentRunRow[]
  usedByRows: Parameters<typeof UsedBySection>[0]['rows']
  historyEntries: Parameters<typeof HistorySection>[0]['entries']
  weekRows: readonly InstrumentWeekBooking[]
  connector: ConnectorWire | null
  qualificationsStatus: 'pending' | 'error' | 'success'
  qualifierError: unknown
  qualificationRows: QualificationRow[]
  qualificationColumns: RegistryColumn<QualificationRow>[]
  scope: string | null
  iAmQualified: boolean
  iHaveAsked: boolean
  requestRows: { id: string; user_id: string; note: string | null }[]
  projectOptions: { id: string; title: string }[]
  members: { user_id: string }[]
  membersError: unknown
  onRequested: () => void
}) {
  const i = instrument
  const { setSetupStep } = page

  const tabBody: Record<InstrumentTab, React.ReactNode> = {
    details: (
      <>
        <LiveReadingsSection
          instrument={i}
          canSetUp={canSetUpIntake}
          canSetLimits={canCalibrate}
        />
        <IntakeSection
          instrument={i}
          intakeItems={intake.intakeItems}
          connector={connector}
          followUp={intake.followUp}
          deliveryProblem={intakeDeliveryProblem(intake.health.label)}
          canSetUpIntake={canSetUpIntake}
          canRecord={canRecord}
          canEditSchemas={canEditSchemas}
          onSetUp={(step) => setSetupStep(step)}
        />
        <IntakeProblems
          workspaceId={workspaceId}
          instrumentId={i.id}
          canManage={canEditSchemas}
        />
        <QualificationSection
          instrumentId={i.id}
          instrumentName={i.name}
          qualificationsStatus={qualificationsStatus}
          qualifierError={qualifierError}
          rows={qualificationRows}
          columns={qualificationColumns}
          scope={scope}
          canQualify={canQualify}
          canRecord={canRecord}
          iAmQualified={iAmQualified}
          iHaveAsked={iHaveAsked}
          requestRows={requestRows}
          userLabel={names.userLabel}
          dismissPending={mutations.dismissRequest.isPending}
          onDismiss={(id) => mutations.dismissRequest.mutate(id)}
          onQualify={(userId) => {
            page.setGrantUser(userId)
            page.setGrantScope(scope ?? '')
            page.setGrantOpen(true)
          }}
          onGrant={() => {
            page.setGrantScope(scope ?? '')
            page.setGrantOpen(true)
          }}
          onRequested={onRequested}
        />
        <RobotSection
          instrument={i}
          canManage={canManageInstruments}
          canRun={canRecord}
        />
      </>
    ),
    bookings: (
      <>
        <InstrumentTimeline instrumentId={i.id} />
        <BookingRulesSection instrument={i} canManage={canManageInstruments} />
        <InstrumentRateSection
          instrument={i}
          canManage={canManageInstruments}
        />
      </>
    ),
    calibration: (
      <CalibrationSection
        latest={latest}
        calibrationRows={calibrationRows}
        calibrationColumns={calibrationColumns}
        canCalibrate={canCalibrate}
        onRecordCalibration={() => page.setRecordOpen(true)}
      />
    ),
    service: (
      <ServiceLogSection instrument={i} canLog={canCalibrate} names={names} />
    ),
    data: (
      <>
        <RunsSection rows={rows} runColumns={runColumns} />
        <ConvertedDataSection instrumentId={i.id} />
        <RunQcPanel
          scope={{ instrumentId: i.id }}
          workspaceId={workspaceId}
          canWrite={canRecord}
        />
        <UsedBySection rows={usedByRows} />
      </>
    ),
    history: (
      <HistorySection entries={historyEntries} userLabel={names.userLabel} />
    ),
  }

  return (
    <RecordPage
      recordId={null}
      trail={[
        {
          label: t('library.instruments.record.instruments'),
          link: { to: '/instruments' },
        },
        { label: i.displayId ?? i.id.slice(0, 8), mono: true },
      ]}
      title={i.name}
      identifier={i.displayId ?? i.id.slice(0, 8)}
      status={
        isOutOfService(i)
          ? {
              tone: 'warn',
              label: t('library.instruments.outOfService.status'),
            }
          : intake.health
      }
      facts={instrumentFacts({
        instrument: i,
        latest,
        lastDataAt: intake.lastDataAt,
        userLabel: names.userLabel,
      })}
      actions={<InstrumentActions instrument={i} />}
      moreLabel={t('library.instruments.record.moreActions')}
      more={
        canRecord || canCalibrate ? (
          <InstrumentMoreItems
            instrument={i}
            canRecord={canRecord}
            canCalibrate={canCalibrate}
            onRecordCalibration={() => page.setRecordOpen(true)}
            onServiceState={(out) =>
              out ? page.setUpOpen(true) : page.setDownOpen(true)
            }
          />
        ) : null
      }
      stateLine={
        <InstrumentStateLine
          instrument={i}
          latest={latest}
          gateMode={gateMode}
          canCalibrate={canCalibrate}
          userLabel={names.userLabel}
          onBackInService={() => page.setUpOpen(true)}
          onRecordCalibration={() => page.setRecordOpen(true)}
        />
      }
      tabs={{
        mode: 'state',
        label: t('library.instruments.record.sections'),
        value: page.tab,
        onValueChange: (next) => page.setTab(instrumentTabOf(next)),
        items: [
          {
            key: 'details',
            label: t('library.instruments.record.detailsTab'),
          },
          {
            key: 'bookings',
            label: t('library.instruments.record.bookingsTab'),
            count: weekRows.length,
          },
          {
            key: 'calibration',
            label: t('library.instruments.record.calibration'),
            count: calibrationRows.length,
          },
          { key: 'service', label: t('library.instruments.record.serviceTab') },
          {
            key: 'data',
            label: t('library.instruments.record.dataTab'),
            count: rows.length,
          },
          {
            key: 'history',
            label: t('notebook.recordPage.history'),
            end: true,
          },
        ],
      }}
      sideLabel={t('library.instruments.record.instrumentDetails')}
      side={
        <InstrumentSidePanel
          instrument={i}
          userLabel={names.userLabel}
          week={weekRows}
        />
      }
      overlays={
        <>
          {page.setupStep !== null ? (
            <IntakeSetupDialog
              workspaceId={workspaceId}
              instrument={{
                id: i.id,
                name: i.name,
                displayId: i.displayId ?? '',
              }}
              intakeMethod={i.intakeMethod}
              connector={connector}
              canManage={canSetUpIntake}
              initialStep={connector ? page.setupStep : 1}
              onClose={() => setSetupStep(null)}
            />
          ) : null}
          <InstrumentDialogs
            instrument={i}
            page={page}
            mutations={mutations}
            projectOptions={projectOptions}
            members={members}
            membersError={membersError}
            userLabel={names.userLabel}
            scope={scope}
          />
        </>
      }
    >
      {tabBody[page.tab]}
    </RecordPage>
  )
}
