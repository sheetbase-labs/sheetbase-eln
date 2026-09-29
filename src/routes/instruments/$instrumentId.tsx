import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  PageHeader,
  DescriptionList,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
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
import { Textarea } from '#/components/v3/inventory/list'
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
import { useUserNames } from '#/lib/user-names'
import {
  calibrationStatus,
  instrumentConnection,
  instrumentQueryKeys,
  recordInstrumentCalibration,
  runStatus,
  useInstrument,
  useInstrumentCalibrations,
  useInstrumentRuns,
} from '#/components/v3/instruments/instruments-data'

/** UI port (roadmap-4/ui-app3): an instrument's record, calibration and run
 * queue (LAB-06). */
export const Route = createFileRoute('/instruments/$instrumentId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: InstrumentPage,
})

function isoDay(offsetDays = 0): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function InstrumentPage() {
  const { instrumentId } = Route.useParams()
  const queryClient = useQueryClient()
  const instrument = useInstrument(instrumentId)
  const runs = useInstrumentRuns(instrumentId)
  const calibrations = useInstrumentCalibrations(instrumentId)
  const [recordOpen, setRecordOpen] = useState(false)
  const [performed, setPerformed] = useState(isoDay())
  const [due, setDue] = useState(isoDay(182))
  const [notes, setNotes] = useState('')
  const i = instrument.data
  const rows = runs.data ?? []
  const calibrationRows = calibrations.data ?? []
  const latest = calibrationRows.at(0) ?? null
  const names = useUserNames(
    calibrationRows.flatMap((c) =>
      c.performedByUserId ? [c.performedByUserId] : [],
    ),
  )

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
  const connection = instrumentConnection(i.connectionStatus)
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
              <Status tone={connection.tone}>{connection.label}</Status>
            </span>
            <span>{i.instrumentType}</span>
            <span className="max-lg:hidden">{i.model ?? '—'}</span>
          </>
        }
        actions={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setRecordOpen(true)}
          >
            Record calibration
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
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
              [
                'Last performed',
                latest?.performedAt ? latest.performedAt.slice(0, 10) : '—',
              ],
              ['Next due', latest?.dueAt ? latest.dueAt.slice(0, 10) : '—'],
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
                        {c.performedAt.slice(0, 10)}
                      </TableCell>
                      <TableCell className="mono">
                        {c.dueAt.slice(0, 10)}
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
              <Field
                label="Notes"
                hint="Optional. Certificate upload comes with the file capability."
              >
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
    </div>
  )
}
