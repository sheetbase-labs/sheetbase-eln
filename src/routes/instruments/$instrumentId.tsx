import { useEffect, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  PageHeader,
  DescriptionList,
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
import { Select } from '#/components/v3/ui/select'
import { FileDrop } from '#/components/v3/ui/file-drop'
import { CalibrationOverdueNotice } from '#/components/v3/instruments/calibration-overdue'
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
  useInstrumentLastImport,
  useInstrumentNextBooking,
  useInstrumentParsers,
  useInstrumentRuns,
} from '#/components/v3/instruments/instruments-data'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'

/** UI port (roadmap-4/ui-app3): an instrument's record, calibration and run
 * queue (LAB-06). */
export const Route = createFileRoute('/instruments/$instrumentId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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
  const d = new Date()
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
  const [recordOpen, setRecordOpen] = useState(false)
  const [performed, setPerformed] = useState(isoDay())
  const [due, setDue] = useState(isoDay(182))
  const [notes, setNotes] = useState('')
  const [certificate, setCertificate] = useState<{
    fileObjectId: string
    displayName: string
  } | null>(null)
  const [certificateProject, setCertificateProject] = useState('')
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
  // The qualification RPCs are workspace-admin (owner) actions.
  const canQualify = hasCapability(context.workspace?.role, 'workspace.admin')
  const workspaceId = context.workspace?.id ?? ''
  const { record: recordParam } = Route.useSearch()
  // The registry's overdue notice deep-links here with ?record=1.
  useEffect(() => {
    if (recordParam === '1' && canRecord) setRecordOpen(true)
  }, [recordParam, canRecord])
  const projects = useQuery({
    queryKey: ['ui-port', 'instrument-certificate-projects'],
    enabled: canRecord && recordOpen,
    queryFn: () =>
      notebookDataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
    staleTime: 60_000,
  })
  const projectOptions = projects.data ?? []
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
          row.original.certificateFileId ? 'Attached' : 'None attached',
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
      id: 'identifier',
      header: 'Identifier',
      cell: ({ row }) => (
        <span className="mono">{row.original.runIdentifier}</span>
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
            label={`Progress for ${row.original.name}`}
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
      id: 'started',
      header: 'Started',
      cell: ({ row }) =>
        row.original.startedAt
          ? row.original.startedAt.slice(0, 16).replace('T', ' ')
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
      header: 'Valid until',
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
          {row.original.current ? 'Current' : 'Expired'}
        </Status>
      ),
    },
    ...(canQualify
      ? [
          {
            id: 'actions',
            header: () => <span className="sr-only">Actions</span>,
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
                Revoke
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
  const names = useUserNames([
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
      toast('Calibration recorded')
    },
    onError: (error: unknown) => {
      toast('Could not record the calibration', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
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
      toast('Qualification granted')
    },
    onError: (error: unknown) => {
      toast('Could not grant the qualification', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
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
      toast('Qualification revoked')
    },
    onError: (error: unknown) => {
      toast('Could not revoke the qualification', {
        description:
          error instanceof Error ? error.message : 'The database refused it.',
      })
    },
  })

  if (!i) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Instruments', link: { to: '/instruments' } }]}
          title={
            instrument.isLoading
              ? 'Loading instrument…'
              : 'Instrument not found'
          }
        />
      </div>
    )
  }
  const parserRows = parsers.data ?? []
  const parserReady =
    parserRows.length > 0 && parserRows.some((parser) => parser.validated)
  const needsParser = intakeMethodNeedsParser(i.intakeMethod)
  const followUp = parserFollowUp(i.id, i.intakeMethod, parsers.data)
  const health = intakeHealth(i.intakeMethod, {
    parserReady: parsers.isSuccess ? parserReady : undefined,
    lastImport: lastImport.data ?? null,
  })
  const lastDataAt =
    lastImport.data?.status === 'committed' ? lastImport.data.createdAt : null
  const nextBooking = !booking.isSuccess
    ? '—'
    : !booking.data.bookable
      ? 'Not bookable'
      : booking.data.next
        ? `${booking.data.next.startsAt.slice(0, 16).replace('T', ' ')} · ${booking.data.next.title}`
        : 'None'
  const parserLabel = !needsParser
    ? 'Not used'
    : parserRows.length
      ? parserRows
          .map(
            (parser) =>
              `${parser.name} · ${parser.validated ? 'validated' : 'not validated'}`,
          )
          .join(', ')
      : 'No parser attached'
  const status = calibrationStatus(latest?.dueAt ?? null)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Instruments', link: { to: '/instruments' } },
          { label: i.displayId ?? i.id.slice(0, 8), mono: true },
        ]}
        title={i.name}
        meta={
          <>
            <span className="text-fg">
              <Status tone={health.tone}>{health.label}</Status>
            </span>
            <span>{i.instrumentType}</span>
            <span className="max-lg:hidden">{i.model ?? '—'}</span>
          </>
        }
        actions={
          canRecord || !i.retiredAt ? (
            <>
              {!i.retiredAt ? (
                <Button
                  variant="secondary"
                  nativeButton={false}
                  render={<Link to="/schedule" search={{ book: i.id }} />}
                >
                  Book
                </Button>
              ) : null}
              {canRecord ? (
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => setRecordOpen(true)}
                >
                  Record calibration
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        <Section title="How data gets in">
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
                'Last data',
                lastDataAt
                  ? lastDataAt.slice(0, 16).replace('T', ' ')
                  : 'Nothing received',
              ],
              ['Next booking', nextBooking],
              ['Parser', parserLabel],
            ]}
          />
          {followUp ? (
            <ParserFollowUpNotice
              instrumentName={i.name}
              followUp={followUp}
              canEdit={hasCapability(context.workspace?.role, 'schema.edit')}
            />
          ) : (
            <Muted className="mt-1.5">
              How data gets in is set on the registry inspector. Imports already
              committed keep the provenance they arrived with.
            </Muted>
          )}
        </Section>

        <Section title="Calibration">
          {status.label === 'Overdue' ? (
            <CalibrationOverdueNotice
              instrumentName={i.name}
              action={
                canRecord ? (
                  <Button size="sm" onClick={() => setRecordOpen(true)}>
                    Record calibration
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
              ['Last performed', formatInstrumentDay(latest?.performedAt)],
              ['Next due', formatInstrumentDay(latest?.dueAt)],
            ]}
          />
          {calibrationRows.length ? (
            <TableBox>
              <RegistryGrid
                label="Calibration history"
                rows={calibrationRows}
                columns={calibrationColumns}
                getRowId={(c) => c.id}
                selectable={false}
              />
            </TableBox>
          ) : (
            <Muted>
              No calibration recorded. Instruments with no in-date calibration
              should not be used.
            </Muted>
          )}
        </Section>

        <Section
          title="Qualification"
          count={
            qualifications.isSuccess ? qualificationRows.length : undefined
          }
        >
          {qualifications.isPending ? (
            <Muted>Loading qualifications…</Muted>
          ) : qualifications.isError ? (
            <Notice tone="bad" title="The qualifications could not be loaded.">
              {qualifications.error instanceof Error
                ? qualifications.error.message
                : 'The database refused the request.'}
            </Notice>
          ) : qualificationRows.length ? (
            <>
              <DescriptionList
                labelWidth={130}
                items={[['Qualified for', scope ?? 'Not set']]}
              />
              <TableBox>
                <RegistryGrid
                  label="Qualified operators"
                  rows={qualificationRows}
                  columns={qualificationColumns}
                  getRowId={(row) => row.user_id}
                  selectable={false}
                />
              </TableBox>
            </>
          ) : (
            <Muted>
              No one is qualified to run {i.name} yet. Booking it requires a
              current qualification.
            </Muted>
          )}
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
                Grant qualification
              </Button>
            </div>
          ) : (
            <Muted className="mt-1.5">
              A workspace owner grants and revokes qualifications. Booking this
              instrument requires one that has not expired.
            </Muted>
          )}
        </Section>

        <Section title="Runs" count={rows.length}>
          {rows.length ? (
            <TableBox>
              <RegistryGrid
                label="Instrument runs"
                rows={rows}
                columns={runColumns}
                getRowId={(r) => r.id}
                selectable={false}
              />
            </TableBox>
          ) : (
            <EmptyState
              icon="pipeline"
              title="No runs yet"
              description="Runs arrive from the instrument when it is used; this tab is read-only."
              className="py-4"
            />
          )}
        </Section>
      </div>

      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader title="Record calibration" />
          <DialogBody>
            <div className="flex flex-col gap-3">
              <Field label="Performed" required>
                <Input
                  type="date"
                  value={performed}
                  onChange={(e) => setPerformed(e.target.value)}
                />
              </Field>
              <Field label="Next due" required>
                <Input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </Field>
              <Field
                label="Certificate project"
                hint="The certificate is kept as a file record in this project."
              >
                <Select
                  value={certificateProjectId}
                  onChange={(e) => setCertificateProject(e.target.value)}
                  disabled={projectOptions.length === 0}
                >
                  {projectOptions.length === 0 ? (
                    <option value="">No projects available</option>
                  ) : null}
                  {projectOptions.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </Select>
              </Field>
              {certificate ? (
                <div className="flex items-center justify-between gap-2 text-label">
                  <span>Certificate: {certificate.displayName}</span>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => setCertificate(null)}
                  >
                    Remove
                  </Button>
                </div>
              ) : projectOptions.length ? (
                <FileDrop
                  label="Attach the calibration certificate"
                  inputLabel="Calibration certificate"
                  hint="Optional, but GxP use needs the certificate on file."
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
                  Certificates are stored in a project, and you can’t see any
                  yet. Ask a project owner to add you, then record the
                  calibration with its certificate.
                </Muted>
              )}
              <Field label="Notes" hint="Optional.">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button />}>Cancel</DialogClose>
            <Button
              variant="primary"
              disabled={!performed || !due || record.isPending}
              onClick={() => record.mutate()}
            >
              {record.isPending ? 'Recording…' : 'Record calibration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="w-[min(520px,calc(100vw-32px))]">
          <DialogHeader
            title="Grant qualification"
            description={`Who may run ${i.name}, and until when`}
          />
          <DialogBody>
            <div className="flex flex-col gap-3">
              <Field label="Person" required>
                <Select
                  value={grantUser}
                  onChange={(e) => setGrantUser(e.target.value)}
                >
                  <option value="">Choose a workspace member…</option>
                  {(members.data ?? []).map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {names.userLabel(member.user_id)}
                    </option>
                  ))}
                </Select>
              </Field>
              {members.isError ? (
                <Notice tone="bad" title="The member list could not be loaded.">
                  {members.error instanceof Error
                    ? members.error.message
                    : 'The database refused the request.'}
                </Notice>
              ) : null}
              <Field
                label="Valid until"
                required
                hint="Booking is refused from this date onwards."
              >
                <Input
                  type="date"
                  min={isoDay(1)}
                  value={grantUntil}
                  onChange={(e) => setGrantUntil(e.target.value)}
                />
              </Field>
              <Field
                label="Qualified for"
                hint={
                  scope
                    ? `The instrument's scope is “${scope}”. Leave blank to keep it.`
                    : 'Optional scope on the instrument, such as “cell culture only”.'
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
            <DialogClose render={<Button />}>Cancel</DialogClose>
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
              {grant.isPending ? 'Granting…' : 'Grant qualification'}
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
            <ConfirmDialogTitle>Revoke the qualification?</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {revokeTarget ? personLabel(revokeTarget) : ''} · until{' '}
              {formatInstrumentDay(revokeTarget?.valid_until)}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <DialogBody>
            <p className="m-0 text-body leading-5">
              Booking {i.name} requires a current qualification, so removing it
              stops new bookings at once. Their past runs and the change history
              stay.
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
              Revoke qualification
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}
