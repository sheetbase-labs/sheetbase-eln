import { formatDate } from '#/lib/format-date'
import { useEffect, useState } from 'react'
import { PickerSelect } from '#/components/v3/record-picker/entity-picker'
import { projectOption } from '#/components/v3/record-picker/entity-options'
import { Select } from '#/components/v3/ui/select'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  PageHeader,
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
import { Progress } from '#/components/v3/ui/progress'
import { Status } from '#/components/v3/ui/status'
import { Notice } from '#/components/v3/ui/alert'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '#/components/v3/ui/dialog'
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from '#/components/v3/ui/confirm-dialog'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { FileDrop } from '#/components/v3/ui/file-drop'
import {
  IntakeDeliveryNotice,
  intakeDeliveryProblem,
} from '#/components/v3/instruments/intake-delivery-notice'
import { IntakeProblems } from '#/components/v3/integrations/intake-problems'
import { CalibrationOverdueNotice } from '#/components/v3/instruments/calibration-overdue'
import {
  AgentStatusLabel,
  AgentStatusLine,
} from '#/components/v3/instruments/agent-download'
import { IntakeSetupDialog } from '#/components/v3/instruments/intake-setup-dialog'
import {
  findInstrumentConnector,
  intakeSetupQueryKeys,
} from '#/lib/connectors/intake-setup'
import {
  fetchParserSettings,
  parserSettingsQueryKeys,
} from '#/lib/parser-settings'
import { canManageSettings } from '#/lib/settings-access'
import { instrumentTypeLabel } from '#/lib/instrument-type-label'
import { useInstrumentGateMode } from '#/lib/instrument-gate'
import { createDataClient } from '#/lib/data-client'
import { uploadProjectFile } from '#/lib/file-attach'
import { Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { hasCapability } from '#/lib/capability'
import { ParserFollowUpNotice } from '#/components/v3/instruments/parser-follow-up'
import { RequestQualificationButton } from '#/components/v3/instruments/request-qualification-button'
import {
  dismissQualificationRequest,
  fetchOpenQualificationRequests,
  qualificationRequestsQueryKey,
} from '#/lib/instrument-qualification-requests'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import {
  calibrationStatus,
  formatInstrumentDay,
  intakeHealth,
  intakeMethodLabel,
  intakeMethodNeedsParser,
  parserFollowUp,
  instrumentQueryKeys,
  recordInstrumentCalibration,
  runStatus,
  useInstrument,
  useInstrumentCalibrations,
  useInstrumentHistory,
  useInstrumentLastImport,
  useInstrumentNextBooking,
  useInstrumentParsers,
  useInstrumentRuns,
  useInstrumentUsedBy,
  useInstrumentWeek,
} from '#/components/v3/instruments/instruments-data'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { now as appNow } from '#/lib/clock'
import { AddedFields } from '#/components/v3/models/added-fields'
import { rich, t } from '#/copy'

const intakeDataClient = createDataClient()

/** UI port (roadmap-4/ui-app3): an instrument's record, calibration and run
 * queue (LAB-06). */
export const Route = createFileRoute('/instruments/$instrumentId')({
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
  validateSearch: (search: Record<string, unknown>): { record?: '1' } => ({
    record: search.record === '1' || search.record === 1 ? '1' : undefined,
  }),
  component: InstrumentPage,
})

function isoDay(offsetDays = 0): string {
  const d = appNow()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/** LAB-06.2 — one person's qualification to run an instrument, as
 * `instrument_qualification_list` reports it. */
interface QualificationRow {
  user_id: string
  user_name: string | null
  valid_until: string
  current: boolean
  qualified_for: string | null
}

const qualificationQueryKey = (instrumentId: string) =>
  ['ui-port', 'instrument-qualifications', instrumentId] as const

function InstrumentPage() {
  const { instrumentId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const instrument = useInstrument(instrumentId)
  const runs = useInstrumentRuns(instrumentId)
  const calibrations = useInstrumentCalibrations(instrumentId)
  const parsers = useInstrumentParsers(instrumentId)
  const lastImport = useInstrumentLastImport(instrumentId)
  const booking = useInstrumentNextBooking(instrumentId)
  const history = useInstrumentHistory(instrumentId)
  const usedBy = useInstrumentUsedBy(instrumentId)
  const week = useInstrumentWeek(instrumentId)
  const [recordOpen, setRecordOpen] = useState(false)
  const [performed, setPerformed] = useState(isoDay())
  const [due, setDue] = useState(isoDay(182))
  const [notes, setNotes] = useState('')
  const [certificate, setCertificate] = useState<{
    fileObjectId: string
    displayName: string
  } | null>(null)
  const [certificateProject, setCertificateProject] = useState('')
  const [setupStep, setSetupStep] = useState<1 | 3 | null>(null)
  const [grantOpen, setGrantOpen] = useState(false)
  const [grantUser, setGrantUser] = useState('')
  const [grantUntil, setGrantUntil] = useState(isoDay(365))
  const [grantScope, setGrantScope] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<QualificationRow | null>(
    null,
  )
  const i = instrument.data
  const rows = runs.data ?? []
  const calibrationRows = calibrations.data ?? []
  const latest = calibrationRows.at(0) ?? null
  const canRecord = hasCapability(context.workspace?.role, 'record.create')
  const canCalibrate = hasCapability(
    context.workspace?.role,
    'calibration.record',
  )
  // The qualification RPCs are workspace-admin (owner) actions.
  const canQualify = hasCapability(context.workspace?.role, 'workspace.admin')
  const workspaceId = context.workspace?.id ?? ''
  const gateMode = useInstrumentGateMode(workspaceId)
  const { record: recordParam } = Route.useSearch()
  // The registry's overdue notice deep-links here with ?record=1.
  useEffect(() => {
    if (recordParam === '1' && canCalibrate) setRecordOpen(true)
  }, [recordParam, canCalibrate])
  const projects = useQuery({
    queryKey: ['ui-port', 'instrument-certificate-projects'],
    enabled: canCalibrate && recordOpen,
    queryFn: () =>
      notebookDataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
    staleTime: 60_000,
  })
  const projectOptions = projects.data ?? []
  const canSetUpIntake = canManageSettings(context.workspace, 'integrations')
  const intakeConnector = useQuery({
    queryKey: intakeSetupQueryKeys.connector(instrumentId),
    enabled: instrumentId.length > 0 && workspaceId.length > 0,
    queryFn: () => findInstrumentConnector(intakeDataClient, instrumentId),
    staleTime: 15_000,
  })
  const intakeParsers = useQuery({
    queryKey: parserSettingsQueryKeys.list(workspaceId),
    enabled: workspaceId.length > 0 && Boolean(intakeConnector.data?.parser_id),
    queryFn: () => fetchParserSettings(intakeDataClient, workspaceId),
  })
  const certificateProjectId = certificateProject || projectOptions[0]?.id || ''

  const qualifications = useQuery({
    queryKey: qualificationQueryKey(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () =>
      notebookDataClient.rpc<QualificationRow[]>(
        'instrument_qualification_list',
        { p_instrument_id: instrumentId },
      ),
    staleTime: 15_000,
  })
  const qualificationRows = qualifications.data ?? []

  const calibrationColumns: RegistryColumn<(typeof calibrationRows)[number]>[] =
    [
      {
        id: 'performed',
        header: 'Performed',
        cell: ({ row }) => (
          <span className="mono">
            {formatInstrumentDay(row.original.performedAt)}
          </span>
        ),
      },
      {
        id: 'due',
        header: 'Due',
        cell: ({ row }) => (
          <span className="mono">
            {formatInstrumentDay(row.original.dueAt)}
          </span>
        ),
      },
      {
        id: 'by',
        header: 'By',
        cell: ({ row }) =>
          row.original.performedByUserId
            ? names.userLabel(row.original.performedByUserId)
            : '—',
      },
      {
        id: 'certificate',
        header: 'Certificate',
        cell: ({ row }) =>
          row.original.certificateFileId
            ? 'Attached'
            : t('library.instruments.record.noneAttached'),
        meta: { cellClassName: 'text-fg-muted' },
      },
      {
        id: 'notes',
        header: 'Notes',
        cell: ({ row }) => row.original.notes ?? '—',
        meta: { cellClassName: 'text-fg-muted' },
      },
    ]

  const runColumns: RegistryColumn<(typeof rows)[number]>[] = [
    {
      id: 'run',
      header: 'Run',
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const run = runStatus(row.original.status)
        return <Status tone={run.tone}>{run.label}</Status>
      },
    },
    {
      id: 'progress',
      header: 'Progress',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Progress
            label={t('library.instruments.record.progressFor', {
              name: row.original.name,
            })}
            value={row.original.progressPercent}
            valueText={`${row.original.progressPercent}%`}
            className="w-20"
          />
          <span className="text-label text-fg-muted">
            {row.original.progressPercent}%
          </span>
        </div>
      ),
      meta: rightAligned<(typeof rows)[number]>().meta,
    },
    {
      id: 'samples',
      header: t('library.instruments.record.runSamples'),
      cell: ({ row }) =>
        row.original.sampleCount > 0 ? row.original.sampleCount : '—',
      meta: rightAligned<(typeof rows)[number]>().meta,
    },
    {
      id: 'experiment',
      header: t('library.instruments.record.runExperiment'),
      cell: ({ row }) =>
        row.original.experiment ? (
          <Link
            to="/experiments/$expId"
            params={{ expId: row.original.experiment.identifier }}
            className="mono hover:underline"
          >
            {row.original.experiment.identifier}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      id: 'dataset',
      header: t('library.instruments.record.runDataset'),
      cell: ({ row }) =>
        row.original.dataset ? (
          <Link
            to="/datasets/$datasetId"
            params={{ datasetId: row.original.dataset.id }}
            className="hover:underline"
            title={row.original.dataset.name}
          >
            <span className="mono">
              {row.original.dataset.displayId ?? row.original.dataset.name}
            </span>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      id: 'started',
      header: 'Started',
      cell: ({ row }) =>
        row.original.startedAt
          ? formatDate(row.original.startedAt, { time: true })
          : '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]

  const qualificationColumns: RegistryColumn<
    (typeof qualificationRows)[number]
  >[] = [
    {
      id: 'person',
      header: 'Person',
      cell: ({ row }) => personLabel(row.original),
    },
    {
      id: 'validUntil',
      header: t('library.instruments.record.validUntil'),
      cell: ({ row }) => (
        <span className="mono">
          {formatInstrumentDay(row.original.valid_until)}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      cell: ({ row }) => (
        <Status tone={row.original.current ? 'ok' : 'bad'}>
          {row.original.current
            ? t('library.instruments.record.current')
            : t('library.instruments.record.expired')}
        </Status>
      ),
    },
    ...(canQualify
      ? [
          {
            id: 'actions',
            header: () => (
              <span className="sr-only">
                {t('library.instruments.record.actions')}
              </span>
            ),
            cell: ({
              row,
            }: {
              row: { original: (typeof qualificationRows)[number] }
            }) => (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setRevokeTarget(row.original)}
              >
                {t('library.instruments.record.revoke')}
              </Button>
            ),
            meta: rightAligned<(typeof qualificationRows)[number]>().meta,
          } satisfies RegistryColumn<(typeof qualificationRows)[number]>,
        ]
      : []),
  ]
  // The scope lives on the instrument; the read model reports it on each row.
  const scope =
    qualificationRows.find((row) => row.qualified_for)?.qualified_for ?? null
  const members = useQuery({
    queryKey: ['ui-port', 'workspace-operators', workspaceId],
    enabled: canQualify && workspaceId.length > 0,
    queryFn: () =>
      notebookDataClient.list<{ user_id: string }>(
        'workspace_memberships',
        `?workspace_id=eq.${encodeURIComponent(workspaceId)}&suspended_at=is.null&select=user_id&order=created_at.asc`,
      ),
    staleTime: 60_000,
  })
  // People who have asked to be qualified: an owner sees everyone's open
  // requests, anyone else only their own (the table's policy decides).
  const openRequests = useQuery({
    queryKey: qualificationRequestsQueryKey(instrumentId),
    enabled: instrumentId.length > 0,
    queryFn: () =>
      fetchOpenQualificationRequests(notebookDataClient, instrumentId),
    staleTime: 15_000,
  })
  const requestRows = openRequests.data ?? []
  const myUserId = context.user.id
  const iAmQualified = qualificationRows.some(
    (row) => row.user_id === myUserId && row.current,
  )
  const iHaveAsked = requestRows.some((row) => row.user_id === myUserId)
  const names = useUserNames([
    ...(i?.ownerId ? [i.ownerId] : []),
    ...(i?.createdByUserId ? [i.createdByUserId] : []),
    ...(history.data ?? []).flatMap((c) =>
      c.actorUserId ? [c.actorUserId] : [],
    ),
    ...(week.data ?? []).flatMap((b) =>
      b.created_by_user_id ? [b.created_by_user_id] : [],
    ),
    ...requestRows.map((row) => row.user_id),
    ...calibrationRows.flatMap((c) =>
      c.performedByUserId ? [c.performedByUserId] : [],
    ),
    ...qualificationRows.map((row) => row.user_id),
    ...(members.data ?? []).map((member) => member.user_id),
  ])
  const personLabel = (row: QualificationRow) =>
    row.user_name ?? names.userLabel(row.user_id)

  const record = useMutation({
    mutationFn: () =>
      recordInstrumentCalibration({
        instrumentId,
        performedAt: `${performed}T00:00:00.000Z`,
        dueAt: `${due}T00:00:00.000Z`,
        certificateFileId: certificate?.fileObjectId ?? null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: instrumentQueryKeys.calibrations(instrumentId),
      })
      setRecordOpen(false)
      setNotes('')
      setCertificate(null)
      toast(t('library.instruments.record.calibrationRecorded'))
    },
    onError: (error: unknown) => {
      toast(t('library.instruments.record.couldNotRecordTheCalibration'), {
        description:
          error instanceof Error
            ? error.message
            : t('library.instruments.record.theDatabaseRefusedIt'),
      })
    },
  })

  // LAB-06.3 — the booking path refuses an unqualified booker, so the record
  // page is where a qualification is granted and revoked.
  const grant = useMutation({
    mutationFn: () =>
      notebookDataClient.rpc('set_instrument_qualification', {
        p_instrument_id: instrumentId,
        p_user_id: grantUser,
        p_valid_until: `${grantUntil}T00:00:00.000Z`,
        p_qualified_for: grantScope.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qualificationQueryKey(instrumentId),
      })
      setGrantOpen(false)
      setGrantUser('')
      setGrantScope('')
      toast(t('library.instruments.record.qualificationGranted'))
    },
    onError: (error: unknown) => {
      toast(t('library.instruments.record.couldNotGrantTheQualification'), {
        description:
          error instanceof Error
            ? error.message
            : t('library.instruments.record.theDatabaseRefusedIt'),
      })
    },
  })

  const dismissRequest = useMutation({
    mutationFn: (requestId: string) =>
      dismissQualificationRequest(notebookDataClient, requestId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qualificationRequestsQueryKey(instrumentId),
      })
      toast(t('library.instruments.record.requestDismissed'))
    },
    onError: (error: unknown) => {
      toast(t('library.instruments.record.couldNotDismissTheRequest'), {
        description:
          error instanceof Error
            ? error.message
            : t('library.instruments.record.theDatabaseRefusedIt'),
      })
    },
  })

  const revoke = useMutation({
    mutationFn: (userId: string) =>
      notebookDataClient.rpc('revoke_instrument_qualification', {
        p_instrument_id: instrumentId,
        p_user_id: userId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qualificationQueryKey(instrumentId),
      })
      setRevokeTarget(null)
      toast(t('library.instruments.record.qualificationRevoked'))
    },
    onError: (error: unknown) => {
      toast(t('library.instruments.record.couldNotRevokeTheQualification'), {
        description:
          error instanceof Error
            ? error.message
            : t('library.instruments.record.theDatabaseRefusedIt'),
      })
    },
  })

  if (!i) {
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
            instrument.isLoading
              ? t('library.instruments.record.loadingInstrument')
              : t('library.instruments.record.instrumentNotFound')
          }
        />
      </div>
    )
  }
  const parserRows = parsers.data ?? []
  const parserReady =
    parserRows.length > 0 && parserRows.some((parser) => parser.validated)
  const needsParser = intakeMethodNeedsParser(i.intakeMethod)
  // Once data intake is set up here the instrument reads files through that
  // setup, so a parser attached by hand isn't what it waits on.
  const connector = intakeConnector.data ?? null
  const followUp = connector
    ? null
    : parserFollowUp(i.id, i.intakeMethod, parsers.data)
  const health = intakeHealth(i.intakeMethod, {
    parserReady: connector
      ? undefined
      : parsers.isSuccess
        ? parserReady
        : undefined,
    lastImport: lastImport.data ?? null,
  })
  const deliveryProblem = intakeDeliveryProblem(health.label)
  const lastDataAt =
    lastImport.data?.status === 'committed' ? lastImport.data.createdAt : null
  const nextBooking = !booking.isSuccess
    ? '—'
    : !booking.data.bookable
      ? t('library.instruments.record.notBookable')
      : booking.data.next
        ? `${formatDate(booking.data.next.startsAt, { time: true })} · ${booking.data.next.title}`
        : 'None'
  const connectorParserLabel = connector
    ? connector.parser_id
      ? (intakeParsers.data?.find((p) => p.key === connector.parser_id)?.name ??
        '—')
      : t('library.instruments.intakeStatus.workItOut')
    : null
  const parserLabel = connectorParserLabel
    ? connectorParserLabel
    : !needsParser
      ? t('library.instruments.record.notUsed')
      : parserRows.length
        ? parserRows
            .map(
              (parser) =>
                `${parser.name} · ${parser.validated ? 'validated' : 'not validated'}`,
            )
            .join(', ')
        : t('library.instruments.record.noParserAttached')
  const status = calibrationStatus(latest?.dueAt ?? null)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
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
            <span className="text-fg">
              <Status tone={health.tone}>{health.label}</Status>
            </span>
            <span>{instrumentTypeLabel(i.instrumentType)}</span>
            <span className="max-lg:hidden">{i.model ?? '—'}</span>
          </>
        }
        actions={
          canRecord || !i.retiredAt ? (
            <>
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
              {!i.retiredAt ? (
                <Button
                  variant="secondary"
                  nativeButton={false}
                  render={<Link to="/schedule" search={{ book: i.id }} />}
                >
                  {t('library.instruments.record.book')}
                </Button>
              ) : null}
              {canCalibrate ? (
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => setRecordOpen(true)}
                >
                  {t('library.instruments.record.recordCalibration')}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-auto">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-auto px-4 py-4 md:px-6 [&>*]:shrink-0">
          <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
            <Section title={t('library.instruments.record.fields')}>
              <DescriptionList
                labelWidth={130}
                items={[
                  ['Manufacturer', i.vendor ?? '—'],
                  ['Model', i.model ?? '—'],
                  [
                    'Serial',
                    <span className="mono">{i.serialNumber ?? '—'}</span>,
                  ],
                  ['Location', i.location ?? '—'],
                  ['Owner', i.ownerId ? names.userLabel(i.ownerId) : '—'],
                  [
                    t('library.instruments.record.qualifiedFor'),
                    i.qualifiedFor ?? t('library.instruments.record.notSet'),
                  ],
                  [
                    t('library.instruments.record.calibrationDue'),
                    latest ? (
                      <Status tone={status.tone}>
                        {formatInstrumentDay(latest.dueAt)}
                      </Status>
                    ) : (
                      t('library.instruments.record.notRecorded')
                    ),
                  ],
                ]}
              />
            </Section>
            <AddedFields
              modelKey="instrument"
              objectId={i.id}
              variant="section"
              labelWidth={130}
            />
            {history.data?.length ? (
              <Section
                title={
                  <Tooltip content="Renaming this instrument or moving it to another room updates every record that mentions it. Anything already signed keeps what it showed at the time.">
                    <span tabIndex={0}>
                      {t('library.instruments.record.changeHistory')}
                    </span>
                  </Tooltip>
                }
              >
                <TableBox>
                  <table className="w-full text-label">
                    <thead>
                      <tr className="text-left text-fg-muted">
                        <th className="px-2 py-1 font-medium">
                          {t('library.instruments.record.when')}
                        </th>
                        <th className="px-2 py-1 font-medium">
                          {t('library.instruments.record.change')}
                        </th>
                        <th className="px-2 py-1 font-medium">
                          {t('library.instruments.record.by')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.map((entry) => (
                        <tr key={entry.id} className="border-t border-border">
                          <td className="px-2 py-1 whitespace-nowrap">
                            {formatInstrumentDay(entry.at)}
                          </td>
                          <td className="px-2 py-1">
                            {entry.changes.length
                              ? entry.changes.map((c) => (
                                  <div key={c.label}>
                                    {c.label}{' '}
                                    <del className="text-fg-muted">
                                      {c.from ?? '—'}
                                    </del>{' '}
                                    →{' '}
                                    <ins className="no-underline">
                                      {c.to ?? '—'}
                                    </ins>
                                  </div>
                                ))
                              : t('library.instruments.record.registered')}
                          </td>
                          <td className="px-2 py-1">
                            {entry.actorUserId
                              ? names.userLabel(entry.actorUserId)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableBox>
              </Section>
            ) : null}
          </div>

          <Section
            title={t('library.instruments.record.usedBy')}
            count={usedBy.data?.length}
          >
            {usedBy.data?.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
                {usedBy.data.map((row) => (
                  <li key={row.key} className="flex gap-3">
                    {row.link ? (
                      <Link
                        to={row.link.to}
                        params={{ datasetId: row.link.id }}
                        className="min-w-0 flex-1"
                      >
                        {row.label}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1">{row.label}</span>
                    )}
                    <span className="text-fg-muted">{row.how}</span>
                    <span className="w-20 text-right text-fg-muted">
                      {formatInstrumentDay(row.since)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>
                {t('library.instruments.record.nothingHasBeenImportedFrom')}
              </Muted>
            )}
          </Section>

          <Section title={t('library.instruments.record.howDataGetsIn')}>
            <DescriptionList
              labelWidth={130}
              items={[
                ['Method', intakeMethodLabel(i.intakeMethod)],
                [
                  'Health',
                  <Status key="h" tone={health.tone}>
                    {health.label}
                  </Status>,
                ],
                [
                  t('library.instruments.record.lastData'),
                  lastDataAt
                    ? formatDate(lastDataAt, { time: true })
                    : t('library.instruments.record.nothingReceived'),
                ],
                [t('library.instruments.record.nextBooking'), nextBooking],
                ['Parser', parserLabel],
                ...(connector
                  ? ([
                      [
                        <AgentStatusLabel key="al" />,
                        <AgentStatusLine key="as" connectorId={connector.id} />,
                      ],
                    ] as Array<[React.ReactNode, React.ReactNode]>)
                  : []),
              ]}
            />
            {canSetUpIntake && !i.retiredAt ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setSetupStep(1)}>
                  {connector
                    ? t('library.instruments.intakeStatus.change')
                    : t('library.instruments.intakeStatus.setUp')}
                </Button>
                {connector ? (
                  <Button size="sm" onClick={() => setSetupStep(3)}>
                    {t('library.instruments.agent.download')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {followUp ? (
              <ParserFollowUpNotice
                instrumentName={i.name}
                followUp={followUp}
                canEdit={hasCapability(context.workspace?.role, 'schema.edit')}
              />
            ) : deliveryProblem ? (
              <IntakeDeliveryNotice
                instrumentId={i.id}
                instrumentName={i.name}
                problem={deliveryProblem}
                canImport={canRecord}
                onSetUp={
                  canSetUpIntake && !connector
                    ? () => setSetupStep(1)
                    : undefined
                }
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

          {setupStep !== null ? (
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
              initialStep={connector ? setupStep : 1}
              onClose={() => setSetupStep(null)}
            />
          ) : null}

          <IntakeProblems
            workspaceId={context.workspace?.id ?? ''}
            instrumentId={i.id}
            canManage={hasCapability(context.workspace?.role, 'schema.edit')}
          />

          <Section title={t('library.instruments.record.calibration')}>
            {status.label === 'Overdue' ? (
              <CalibrationOverdueNotice
                instrumentName={i.name}
                gateMode={gateMode}
                action={
                  canCalibrate ? (
                    <Button size="sm" onClick={() => setRecordOpen(true)}>
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
                {t(
                  'library.instruments.record.noCalibrationRecordedInstrumentsWith',
                )}
              </Muted>
            )}
          </Section>

          <Section
            title={t('library.instruments.record.qualification')}
            count={
              qualifications.isSuccess ? qualificationRows.length : undefined
            }
          >
            {qualifications.isPending ? (
              <Muted>
                {t('library.instruments.record.loadingQualifications')}
              </Muted>
            ) : qualifications.isError ? (
              <Notice
                tone="bad"
                title={t(
                  'library.instruments.record.theQualificationsCouldNotBe',
                )}
              >
                {qualifications.error instanceof Error
                  ? qualifications.error.message
                  : t(
                      'library.instruments.record.theDatabaseRefusedTheRequest',
                    )}
              </Notice>
            ) : qualificationRows.length ? (
              <>
                <DescriptionList
                  labelWidth={130}
                  items={[
                    [
                      t('library.instruments.record.qualifiedFor'),
                      scope ?? t('library.instruments.record.notSet'),
                    ],
                  ]}
                />
                <TableBox>
                  <RegistryGrid
                    label={t('library.instruments.record.qualifiedOperators')}
                    rows={qualificationRows}
                    columns={qualificationColumns}
                    getRowId={(row) => row.user_id}
                    selectable={false}
                  />
                </TableBox>
              </>
            ) : (
              <Muted>
                {t('library.instruments.record.noOneIsQualifiedTo', {
                  name: i.name,
                })}
              </Muted>
            )}
            {canQualify && requestRows.length ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <h3 className="m-0 text-label font-medium text-fg">
                  {t('library.instruments.record.waitingToBeQualified')}
                </h3>
                {requestRows.map((request) => (
                  <div
                    key={request.id}
                    className="flex flex-wrap items-center gap-2 text-body"
                  >
                    <span className="font-medium text-fg">
                      {names.userLabel(request.user_id)}
                    </span>
                    {request.note ? (
                      <span className="text-fg-muted">{request.note}</span>
                    ) : null}
                    <span className="ml-auto flex gap-1.5">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setGrantUser(request.user_id)
                          setGrantScope(scope ?? '')
                          setGrantOpen(true)
                        }}
                      >
                        {t('library.instruments.record.qualify')}
                      </Button>
                      <Button
                        size="sm"
                        disabled={dismissRequest.isPending}
                        onClick={() => dismissRequest.mutate(request.id)}
                      >
                        {t('common.actions.dismiss')}
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {canQualify ? (
              <div className="mt-1.5">
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() => {
                    setGrantScope(scope ?? '')
                    setGrantOpen(true)
                  }}
                >
                  {t('library.instruments.record.grantQualification')}
                </Button>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-col gap-1.5">
                <Muted>
                  {t('library.instruments.record.aWorkspaceOwnerGrantsAnd')}
                </Muted>
                {iAmQualified || !canRecord ? null : (
                  <div>
                    <RequestQualificationButton
                      instrumentId={instrumentId}
                      instrumentName={i.name}
                      alreadyRequested={iHaveAsked}
                      onRequested={() =>
                        void queryClient.invalidateQueries({
                          queryKey: qualificationRequestsQueryKey(instrumentId),
                        })
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section
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
        </div>
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
                [
                  'By',
                  i.createdByUserId ? names.userLabel(i.createdByUserId) : '—',
                ],
              ]}
            />
          </InspectorSection>
          <InspectorSection
            title={t('library.instruments.record.bookingsThisWeek')}
          >
            {week.data?.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-label">
                {week.data.map((b) => (
                  <li key={b.id}>
                    {b.starts_at.slice(5, 10)} {b.starts_at.slice(11, 16)} ·{' '}
                    {b.created_by_user_id
                      ? names.userLabel(b.created_by_user_id)
                      : b.title}
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>
                {t('library.instruments.record.noneInTheNextSeven')}
              </Muted>
            )}
          </InspectorSection>
        </Inspector>
      </div>

      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.instruments.record.recordCalibration')}
          />
          <DialogBody>
            <div className="flex flex-col gap-3">
              <Field label={t('library.instruments.record.performed')} required>
                <Input
                  type="date"
                  value={performed}
                  onChange={(e) => setPerformed(e.target.value)}
                />
              </Field>
              <Field label={t('library.instruments.record.nextDue')} required>
                <Input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
              <Field
                label={t('library.instruments.record.certificateProject')}
                hint={t('library.instruments.record.theCertificateIsKeptAs')}
              >
                <PickerSelect
                  noun="project"
                  value={certificateProjectId}
                  onChange={(id) => setCertificateProject(id)}
                  disabled={projectOptions.length === 0}
                  placeholder={
                    projectOptions.length === 0
                      ? 'No projects available'
                      : undefined
                  }
                  options={projectOptions.map((project) =>
                    projectOption(project),
                  )}
                />
              </Field>
              {certificate ? (
                <div className="flex items-center justify-between gap-2 text-label">
                  <span>
                    {t('library.instruments.record.certificate', {
                      displayName: certificate.displayName,
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setCertificate(null)}
                  >
                    {t('common.actions.remove')}
                  </Button>
                </div>
              ) : projectOptions.length ? (
                <FileDrop
                  label={t(
                    'library.instruments.record.attachTheCalibrationCertificate',
                  )}
                  inputLabel="Calibration certificate"
                  hint={t('library.instruments.record.optionalButGxpUseNeeds')}
                  onFile={async (file) => {
                    if (!file) return
                    setCertificate(
                      await uploadProjectFile({
                        projectId: certificateProjectId,
                        file,
                      }),
                    )
                  }}
                />
              ) : (
                <Muted>
                  {t('library.instruments.record.certificatesAreStoredInA')}
                </Muted>
              )}
              <Field
                label={t('library.instruments.record.notes')}
                hint={t('library.instruments.record.optional')}
              >
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              disabled={!performed || !due || record.isPending}
              onClick={() => record.mutate()}
            >
              {record.isPending
                ? t('library.instruments.record.recording')
                : t('library.instruments.record.recordCalibration')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader
            title={t('library.instruments.record.grantQualification')}
            description={t('library.instruments.record.whoMayRunAndUntil', {
              name: i.name,
            })}
          />
          <DialogBody>
            <div className="flex flex-col gap-3">
              <Field label={t('library.instruments.record.person')} required>
                <Select
                  value={grantUser}
                  onChange={(e) => setGrantUser(e.target.value)}
                >
                  <option value="">
                    {t('library.instruments.record.chooseAWorkspaceMember')}
                  </option>
                  {(members.data ?? []).map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {names.userLabel(member.user_id)}
                    </option>
                  ))}
                </Select>
              </Field>
              {members.isError ? (
                <Notice
                  tone="bad"
                  title={t('library.instruments.record.theMemberListCouldNot')}
                >
                  {members.error instanceof Error
                    ? members.error.message
                    : t(
                        'library.instruments.record.theDatabaseRefusedTheRequest',
                      )}
                </Notice>
              ) : null}
              <Field
                label={t('library.instruments.record.validUntil')}
                required
                hint={t('library.instruments.record.bookingIsRefusedFromThis')}
              >
                <Input
                  type="date"
                  min={isoDay(1)}
                  value={grantUntil}
                  onChange={(e) => setGrantUntil(e.target.value)}
                />
              </Field>
              <Field
                label={t('library.instruments.record.qualifiedFor')}
                hint={
                  scope
                    ? t(
                        'library.instruments.record.theInstrumentsScopeIsLeave',
                        { scope },
                      )
                    : t(
                        'library.instruments.record.optionalScopeOnTheInstrument',
                      )
                }
              >
                <Input
                  value={grantScope}
                  onChange={(e) => setGrantScope(e.target.value)}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>
              {t('common.actions.cancel')}
            </DialogClose>
            <Button
              variant="primary"
              disabled={
                !grantUser ||
                !grantUntil ||
                grantUntil <= isoDay() ||
                grant.isPending
              }
              onClick={() => grant.mutate()}
            >
              {grant.isPending
                ? t('library.instruments.record.granting')
                : t('library.instruments.record.grantQualification')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null)
        }}
      >
        <ConfirmDialogContent className="w-[min(480px,calc(100vw-32px))]">
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t('library.instruments.record.revokeTheQualification')}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {revokeTarget ? personLabel(revokeTarget) : ''}{' '}
              {t('library.instruments.record.until', {
                valid_until: formatInstrumentDay(revokeTarget?.valid_until),
              })}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <DialogBody>
            <p className="m-0 text-body leading-5">
              {t(
                'library.instruments.record.bookingRequiresACurrentQualification',
                { name: i.name },
              )}
            </p>
          </DialogBody>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={revoke.isPending} />
            <ConfirmDialogAction
              variant="danger-fill"
              disabled={revoke.isPending}
              onClick={() => {
                if (revokeTarget) revoke.mutate(revokeTarget.user_id)
              }}
            >
              {t('library.instruments.record.revokeQualification')}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
