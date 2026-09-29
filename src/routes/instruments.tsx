import { useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  stickyCell,
  stickyHead,
} from '#/components/v3/inventory/list'
import {
  calibrationStatus,
  instrumentConnection,
  useInstrumentCalibrations,
  useInstruments,
} from '#/components/v3/instruments/instruments-data'

/** UI port (roadmap-4/ui-app3): the Instruments area (LAB-06), folded from
 * DEC-03's /instrument-monitor. Reads the real instrument registry. */
export const Route = createFileRoute('/instruments')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; selected?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: InstrumentsRoute,
})

function InstrumentsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/instruments',
  })
  return isIndex ? <InstrumentsList /> : <Outlet />
}

function InstrumentsList() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const query = useInstruments()
  const rows = query.data ?? []
  const [selected, setSelected] = useState<string | null>(null)

  const q = (search.q ?? '').trim().toLowerCase()
  const visible = useMemo(
    () =>
      rows.filter(
        (i) =>
          !q ||
          `${i.displayId ?? ''} ${i.name} ${i.instrumentType} ${i.model ?? ''}`
            .toLowerCase()
            .includes(q),
      ),
    [rows, q],
  )
  const sel =
    visible.find((i) => i.id === (selected ?? search.selected)) ?? visible.at(0)
  const calibrations = useInstrumentCalibrations(sel?.id ?? '')
  const latestCalibration = calibrations.data?.at(0) ?? null
  const calibration = calibrationStatus(latestCalibration?.dueAt ?? null)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader title="Instruments" total={rows.length} />
        <ListToolbar
          q={search.q}
          label="Search instruments"
          placeholder="Search instruments"
          onSearch={(next) =>
            void navigate({
              to: '/instruments',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <Table aria-label="Instruments" className="max-lg:hidden">
            <TableHeader>
              <TableRow>
                <TableHead className={stickyHead}>ID</TableHead>
                <TableHead>Instrument</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Connection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((i) => (
                <TableRow
                  key={i.id}
                  selected={i.id === sel?.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(i.id)}
                >
                  <TableCell className={stickyCell}>
                    <span className="mono">
                      {i.displayId ?? i.id.slice(0, 8)}
                    </span>
                  </TableCell>
                  <TableCell
                    className={i.id === sel?.id ? 'font-medium' : undefined}
                  >
                    <Link
                      to="/instruments/$instrumentId"
                      params={{ instrumentId: i.id }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {i.name}
                    </Link>
                  </TableCell>
                  <TableCell>{i.instrumentType}</TableCell>
                  <TableCell className="text-fg-muted">
                    {i.model ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Status
                      tone={instrumentConnection(i.connectionStatus).tone}
                    >
                      {instrumentConnection(i.connectionStatus).label}
                    </Status>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <MobileList
            label="Instruments"
            items={visible.map((i) => ({
              key: i.id,
              id: i.displayId ?? i.id.slice(0, 8),
              title: i.name,
              sub: `${i.instrumentType} · ${i.model ?? '—'}`,
              status: (
                <Status tone={instrumentConnection(i.connectionStatus).tone}>
                  {instrumentConnection(i.connectionStatus).label}
                </Status>
              ),
              link: {
                to: '/instruments/$instrumentId',
                params: { instrumentId: i.id },
              },
            }))}
          />
          {!query.isLoading && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                icon="pipeline"
                className="items-center py-14 text-center"
                title={
                  q
                    ? `No instruments match “${search.q}”`
                    : 'No instruments yet'
                }
                body="Instruments appear here once they are registered for the workspace."
              />
            </div>
          ) : null}
        </div>
        <ListFooter right={sel ? '1 selected' : undefined}>
          {visible.length} of {rows.length} instruments
        </ListFooter>
      </div>

      {sel ? (
        <Inspector
          aria-label="Instrument details"
          className="w-[320px] gap-0 p-0"
        >
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">
              {sel.displayId ?? sel.id.slice(0, 8)}
            </span>
            <div className="font-heading text-doc font-semibold">
              {sel.name}
            </div>
            <div className="text-label">
              <Status tone={instrumentConnection(sel.connectionStatus).tone}>
                {instrumentConnection(sel.connectionStatus).label}
              </Status>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title="Details">
              <DescriptionList
                labelWidth={90}
                items={[
                  ['Type', sel.instrumentType],
                  ['Model', sel.model ?? '—'],
                  ['Serial', sel.serialNumber ?? '—'],
                  ['Vendor', sel.vendor ?? '—'],
                  [
                    'Last connected',
                    sel.lastConnectedAt
                      ? sel.lastConnectedAt.slice(0, 16).replace('T', ' ')
                      : '—',
                  ],
                ]}
              />
            </InspectorSection>
            <InspectorSection title="Calibration">
              <DescriptionList
                labelWidth={90}
                items={[
                  [
                    'Status',
                    <Status key="c" tone={calibration.tone}>
                      {calibration.label}
                    </Status>,
                  ],
                  [
                    'Next due',
                    latestCalibration?.dueAt
                      ? latestCalibration.dueAt.slice(0, 10)
                      : '—',
                  ],
                ]}
              />
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}
    </div>
  )
}
