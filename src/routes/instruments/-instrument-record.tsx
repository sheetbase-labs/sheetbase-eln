import { IntakeProblems } from '#/components/integrations/intake-problems'
import { ServiceLogSection } from '#/components/instruments/out-of-service'
import { BookingRulesSection } from '#/components/instruments/booking-rules'
import { InstrumentRateSection } from '#/components/facility/instrument-rate'
import { IntakeSetupDialog } from '#/components/instruments/intake-setup-dialog'
import { ConvertedDataSection } from '#/components/instruments/converted-data'
import { InstrumentTimeline } from '#/components/scheduler/instrument-timeline'
import { RobotSection } from '#/components/instruments/robot-section'
import { RunQcPanel } from '#/components/quality/run-qc-panel'
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
import {
  FieldsSection,
  HistorySection,
  InstrumentAddedFields,
  UsedBySection,
} from './-instrument-fields'
import type { useInstrumentMutations } from './-instrument-mutations'
import type { useInstrumentPageState } from './-instrument-page-state'
import { QualificationSection } from './-instrument-qualification'
import {
  InstrumentHeader,
  InstrumentInspector,
  InstrumentSummary,
  RunsSection,
} from './-instrument-sections'
import type { instrumentIntake } from './-instrument-summary-data'

/**
 * The instrument record once its reads have answered: the header, the record
 * itself, its qualifications, runs and dialogs.
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
  weekRows: Parameters<typeof InstrumentInspector>[0]['week']
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

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <InstrumentHeader
        instrument={i}
        health={intake.health}
        canRecord={canRecord}
        canCalibrate={canCalibrate}
        onServiceState={(out) =>
          out ? page.setUpOpen(true) : page.setDownOpen(true)
        }
        onRecordCalibration={() => page.setRecordOpen(true)}
      />
      <div className="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-auto">
        <InstrumentSummary
          instrument={i}
          health={intake.health}
          lastDataAt={intake.lastDataAt}
          intakeItems={intake.intakeItems}
          userLabel={names.userLabel}
          connector={connector}
          followUp={intake.followUp}
          canSetUpIntake={canSetUpIntake}
          canRecord={canRecord}
          canEditSchemas={canEditSchemas}
          canCalibrate={canCalibrate}
          latest={latest}
          calibrationRows={calibrationRows}
          calibrationColumns={calibrationColumns}
          gateMode={gateMode}
          onSetUp={(step) => setSetupStep(step)}
          onRecordCalibration={() => page.setRecordOpen(true)}
        >
          <ServiceLogSection
            instrument={i}
            canLog={canCalibrate}
            names={names}
          />

          <RunQcPanel
            scope={{ instrumentId: i.id }}
            workspaceId={workspaceId}
            canWrite={canRecord}
          />

          <ConvertedDataSection instrumentId={i.id} />

          <RobotSection
            instrument={i}
            canManage={canManageInstruments}
            canRun={canRecord}
          />

          <InstrumentTimeline instrumentId={i.id} />

          <BookingRulesSection
            instrument={i}
            canManage={canManageInstruments}
          />

          <InstrumentRateSection
            instrument={i}
            canManage={canManageInstruments}
          />

          <FieldsSection
            instrument={i}
            userLabel={names.userLabel}
            latest={latest}
          />

          <UsedBySection rows={usedByRows} />

          <InstrumentAddedFields instrumentId={i.id} />

          <HistorySection
            entries={historyEntries}
            userLabel={names.userLabel}
          />

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

          <RunsSection rows={rows} runColumns={runColumns} />
        </InstrumentSummary>

        <InstrumentInspector
          latest={latest}
          instrument={i}
          userLabel={names.userLabel}
          week={weekRows}
        />
      </div>

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
    </div>
  )
}
