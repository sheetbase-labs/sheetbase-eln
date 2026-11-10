import { useEffect } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { canManageSettings } from '#/lib/settings-access'
import { useInstrumentGateMode } from '#/lib/instrument-gate'
import { hasCapability } from '#/lib/capability'
import { qualificationRequestsQueryKey } from '#/lib/instrument-qualification-requests'
import { useUserNames } from '#/lib/user-names'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'

import {
  calibrationColumnsOf,
  qualificationColumnsOf,
  runColumnsOf,
} from './-instrument-columns'
import { useInstrumentMutations } from './-instrument-mutations'
import { InstrumentRecord } from './-instrument-record'
import { InstrumentUnavailable } from './-instrument-sections'
import { useInstrumentPageQueries } from './-instrument-page-queries'
import { useInstrumentPageState } from './-instrument-page-state'
import {
  instrumentIntake,
  instrumentPageFacts,
  instrumentUserIds,
} from './-instrument-summary-data'

/** UI port (roadmap-4/ui-app3): an instrument's record, calibration and run
 * queue (LAB-06). */
export const Route = createFileRoute('/instruments/$instrumentId')({
  validateSearch: (
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack hands the raw search object here; the decode below is the only thing that reads it.
    search: Record<string, unknown>,
  ): InstrumentSearch => ({
    record: search.record === '1' || search.record === 1 ? '1' : undefined,
  }),
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    await resolveIdentifierParam({
      entity: 'instrument',
      ref: params.instrumentId,
      href: location.href,
    })

    return { context }
  },
  component: InstrumentPage,
})

/** The one search key this route reads. */
interface InstrumentSearch {
  record?: '1'
}

function InstrumentPage() {
  const { instrumentId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()

  // A viewer reads the record; the buttons that change it are not theirs.
  const canRecord = hasCapability(context.workspace?.role, 'record.create')

  const canCalibrate = hasCapability(
    context.workspace?.role,
    'calibration.record',
  )

  // The qualification RPCs are workspace-admin (owner) actions.
  const canQualify = hasCapability(context.workspace?.role, 'workspace.admin')
  const workspaceId = context.workspace?.id ?? ''
  const gateMode = useInstrumentGateMode(workspaceId)

  const page = useInstrumentPageState()
  const { recordOpen, setRecordOpen, setRevokeTarget } = page

  const {
    instrument,
    runs,
    calibrations,
    parsers,
    lastImport,
    booking,
    history,
    usedBy,
    week,
    projects,
    intakeConnector,
    intakeParsers,
    qualifications,
    members,
    openRequests,
  } = useInstrumentPageQueries({
    instrumentId,
    workspaceId,
    canCalibrate,
    canQualify,
    recordOpen,
  })

  const { record: recordParam } = Route.useSearch()
  // The registry's overdue notice deep-links here with ?record=1.
  useEffect(() => {
    if (recordParam === '1' && canCalibrate) setRecordOpen(true)
  }, [recordParam, canCalibrate, setRecordOpen])

  const i = instrument.data

  const {
    rows,
    calibrationRows,
    latest,
    projectOptions,
    qualificationRows,
    requestRows,
    scope,
    iAmQualified,
    iHaveAsked,
  } = instrumentPageFacts({
    runs: runs.data,
    calibrations: calibrations.data,
    projects: projects.data,
    qualifications: qualifications.data,
    openRequests: openRequests.data,
    currentUserId: context.user.id,
  })

  const canSetUpIntake = canManageSettings(context.workspace, 'integrations')

  const { record, grant, dismissRequest, revoke } = useInstrumentMutations({
    instrumentId,
    onRecorded: () => {
      page.setRecordOpen(false)
      page.setNotes('')
      page.setCertificate(null)
    },
    onGranted: () => {
      page.setGrantOpen(false)
      page.setGrantUser('')
      page.setGrantScope('')
    },
    onRevoked: () => setRevokeTarget(null),
  })

  const names = useUserNames(
    instrumentUserIds({
      instrument: i,
      history: history.data ?? [],
      week: week.data ?? [],
      openRequests: openRequests.data ?? [],
      calibrationRows,
      qualificationRows,
      members: members.data ?? [],
    }),
  )

  const calibrationColumns = calibrationColumnsOf(names.userLabel)
  const runColumns = runColumnsOf()

  const qualificationColumns = qualificationColumnsOf({
    canQualify,
    onRevoke: (row) => setRevokeTarget(row),
    personLabel: (row) => row.user_name ?? names.userLabel(row.user_id),
  })

  if (!i) {
    return (
      <InstrumentUnavailable
        query={instrument}
        loading={instrument.isLoading}
      />
    )
  }

  const connector = intakeConnector.data ?? null

  const intake = instrumentIntake({
    instrumentId,
    intakeMethod: i.intakeMethod,
    parsers: parsers.data,
    parsersSettled: parsers.isSuccess,
    connector,
    intakeParsers: intakeParsers.data,
    lastImport: lastImport.data,
    booking: booking.data,
  })

  return (
    <InstrumentRecord
      instrument={i}
      intake={intake}
      names={names}
      page={page}
      mutations={{ record, grant, dismissRequest, revoke }}
      canRecord={canRecord}
      canCalibrate={canCalibrate}
      canQualify={canQualify}
      canSetUpIntake={canSetUpIntake}
      canEditSchemas={hasCapability(context.workspace?.role, 'schema.edit')}
      canManageInstruments={hasCapability(
        context.workspace?.role,
        'instrument.manage',
      )}
      workspaceId={workspaceId}
      gateMode={gateMode}
      latest={latest}
      calibrationRows={calibrationRows}
      calibrationColumns={calibrationColumns}
      runColumns={runColumns}
      rows={rows}
      usedByRows={usedBy.data ?? []}
      historyEntries={history.data ?? []}
      weekRows={week.data ?? []}
      connector={connector}
      qualificationsStatus={
        qualifications.isPending
          ? 'pending'
          : qualifications.isError
            ? 'error'
            : 'success'
      }
      qualifierError={qualifications.error}
      qualificationRows={qualificationRows}
      qualificationColumns={qualificationColumns}
      scope={scope}
      iAmQualified={iAmQualified}
      iHaveAsked={iHaveAsked}
      requestRows={requestRows}
      projectOptions={projectOptions}
      members={members.data ?? []}
      membersError={members.error}
      onRequested={() =>
        void queryClient.invalidateQueries({
          queryKey: qualificationRequestsQueryKey(instrumentId),
        })
      }
    />
  )
}
