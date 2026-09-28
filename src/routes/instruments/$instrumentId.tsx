import { createFileRoute, Link, redirect } from '@tanstack/react-router'

import { PageHeader, Muted, Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  instrumentConnection,
  runStatus,
  useInstrument,
  useInstrumentRuns,
} from '#/components/v3/instruments/instruments-data'

/** UI port (roadmap-4/ui-app3): an instrument's record and run queue (LAB-06). */
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

function InstrumentPage() {
  const { instrumentId } = Route.useParams()
  const instrument = useInstrument(instrumentId)
  const runs = useInstrumentRuns(instrumentId)
  const i = instrument.data

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
  const rows = runs.data ?? []

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
      />
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
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
                    const status = runStatus(r.status)
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="mono">
                          {r.runIdentifier}
                        </TableCell>
                        <TableCell>
                          <Status tone={status.tone}>{status.label}</Status>
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
        <Muted className="mt-4">
          Calibration records are not modelled yet; this page shows the
          instrument and its run queue.
        </Muted>
      </div>
    </div>
  )
}
