import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  PageHeader,
  DescriptionList,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
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
import { Select, Textarea } from '#/components/v3/inventory/list'
import { toast } from '#/components/v3/ui/sonner'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { hasCapability } from '#/lib/capability'
import { notebookDataClient } from '#/lib/notebook-data'
import { useUserNames } from '#/lib/user-names'
import {
  calibrationStatus,
  formatInstrumentDay,
  intakeHealth,
  intakeMethodLabel,
  intakeMethodNeedsParser,
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
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: instrumentQueryKeys.calibrations(instrumentId),
      })
      setRecordOpen(false)
      setNotes('')
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
          crumbs={
            <Link to="/instruments" className="text-link">
              Instruments
            </Link>
          }
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
        crumbs={
          <>
            <Link to="/instruments" className="text-link">
              Instruments
            </Link>{' '}
            / <span className="mono">{i.displayId ?? i.id.slice(0, 8)}</span>
          </>
        }
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
          {needsParser && parsers.isSuccess && !parserReady ? (
            <Notice tone="warn" title="Parser not validated.">
              Readings from {i.name} can’t be imported into a GxP dataset until
              a validated parser is attached to it.
            </Notice>
          ) : (
            <Muted className="mt-1.5">
              How data gets in is set on the registry inspector. Imports already
              committed keep the provenance they arrived with.
            </Muted>
          )}
        </Section>

        <Section title="Calibration">
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
              <Table aria-label="Calibration history">
                <TableHeader>
                  <TableRow>
                    <TableHead>Performed</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calibrationRows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="mono">
                        {formatInstrumentDay(c.performedAt)}
                      </TableCell>
                      <TableCell className="mono">
                        {formatInstrumentDay(c.dueAt)}
                      </TableCell>
                      <TableCell>
                        {c.performedByUserId
                          ? names.userLabel(c.performedByUserId)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {c.notes ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
                <Table aria-label="Qualified operators">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Person</TableHead>
                      <TableHead>Valid until</TableHead>
                      <TableHead>State</TableHead>
                      {canQualify ? <TableHead aria-label="Actions" /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qualificationRows.map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell>{personLabel(row)}</TableCell>
                        <TableCell className="mono">
                          {formatInstrumentDay(row.valid_until)}
                        </TableCell>
                        <TableCell>
                          <Status tone={row.current ? 'ok' : 'bad'}>
                            {row.current ? 'Current' : 'Expired'}
                          </Status>
                        </TableCell>
                        {canQualify ? (
                          <TableCell align="right">
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => setRevokeTarget(row)}
                            >
                              Revoke
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
              <Table aria-label="Instrument runs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Identifier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead align="right">Progress</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const run = runStatus(r.status)
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="mono">
                          {r.runIdentifier}
                        </TableCell>
                        <TableCell>
                          <Status tone={run.tone}>{run.label}</Status>
                        </TableCell>
                        <TableCell align="right">
                          {r.progressPercent}%
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {r.startedAt
                            ? r.startedAt.slice(0, 16).replace('T', ' ')
                            : '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <EmptyState
              icon="pipeline"
              title="No runs yet"
              body="Runs appear here when the instrument is used."
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
