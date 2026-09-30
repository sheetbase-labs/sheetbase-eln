import { useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Dot } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { toast } from '#/components/v3/ui/sonner'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from '#/components/v3/ui/dialog'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  SearchTabs,
  Select,
  stickyCell,
  stickyHead,
} from '#/components/v3/inventory/list'
import {
  createInstrument,
  instrumentConnection,
  setInstrumentRetired,
  useInstruments,
  useLatestCalibrationsByInstrument,
} from '#/components/v3/instruments/instruments-data'
import type { InstrumentRow } from '#/components/v3/instruments/instruments-data'
import { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'

/** UI port (roadmap-4/ui-app3): the Instruments area (LAB-06). Reads the real
 * instrument registry with its calibration standing; registering and retiring
 * go through the canonical RPCs. */
export const Route = createFileRoute('/instruments')({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    tab?: 'all' | 'connected' | 'calibration' | 'retired'
    q?: string
    type?: string
    connection?: string
    calibration?: string
    selected?: string
    state?: 'empty' | 'denied'
  } => ({
    tab:
      search.tab === 'connected' ||
      search.tab === 'calibration' ||
      search.tab === 'retired'
        ? search.tab
        : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    type: typeof search.type === 'string' ? search.type : undefined,
    connection:
      typeof search.connection === 'string' ? search.connection : undefined,
    calibration:
      typeof search.calibration === 'string' ? search.calibration : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    state:
      search.state === 'empty' || search.state === 'denied'
        ? search.state
        : undefined,
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

const tabLabels = {
  all: 'All',
  connected: 'Connected',
  calibration: 'Calibration due',
  retired: 'Retired',
} as const

function InstrumentsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/instruments',
  })
  return isIndex ? <InstrumentsList /> : <Outlet />
}

type CalibrationState = 'ok' | 'soon' | 'overdue' | 'na'

function calibrationState(
  dueAt: string | null | undefined,
  now: Date = new Date(),
): {
  state: CalibrationState
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'none'
} {
  if (!dueAt) return { state: 'na', label: 'Not calibrated', tone: 'none' }
  const due = Date.parse(dueAt)
  if (Number.isNaN(due))
    return { state: 'na', label: 'Not calibrated', tone: 'none' }
  const days = Math.floor((due - now.getTime()) / 86_400_000)
  if (days < 0)
    return {
      state: 'overdue',
      label: `${dueAt.slice(0, 10)} · ${-days} d overdue`,
      tone: 'bad',
    }
  if (days <= 14)
    return {
      state: 'soon',
      label: `${dueAt.slice(0, 10)} · due in ${days} d`,
      tone: 'warn',
    }
  return { state: 'ok', label: dueAt.slice(0, 10), tone: 'ok' }
}

function InstrumentsList() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const query = useInstruments()
  const calibrations = useLatestCalibrationsByInstrument()
  const rows = query.data ?? []
  const role = context.workspace?.role

  const latest = calibrations.data ?? new Map()
  const calFor = (id: string) => calibrationState(latest.get(id)?.dueAt ?? null)

  const names = useUserNames(
    rows.map((i) => i.ownerId ?? '').filter(Boolean),
    context.user,
  )

  const types = useMemo(
    () => [...new Set(rows.map((i) => i.instrumentType))].sort(),
    [rows],
  )

  const tab = search.tab ?? 'all'
  const counts = {
    all: rows.length,
    connected: rows.filter(
      (i) => !i.retiredAt && i.connectionStatus === 'connected',
    ).length,
    calibration: rows.filter((i) => {
      if (i.retiredAt) return false
      const c = calFor(i.id).state
      return c === 'overdue' || c === 'soon'
    }).length,
    retired: rows.filter((i) => i.retiredAt).length,
  }

  const q = (search.q ?? '').trim().toLowerCase()
  const visible = rows.filter((i) => {
    if (
      tab === 'connected' &&
      (i.retiredAt || i.connectionStatus !== 'connected')
    )
      return false
    if (tab === 'calibration') {
      const c = calFor(i.id).state
      if (i.retiredAt || (c !== 'overdue' && c !== 'soon')) return false
    }
    if (tab === 'retired' && !i.retiredAt) return false
    if (tab === 'all' && i.retiredAt) return false
    if (search.type && i.instrumentType !== search.type) return false
    if (search.connection && i.connectionStatus !== search.connection)
      return false
    if (search.calibration && calFor(i.id).state !== search.calibration)
      return false
    if (q) {
      const hay =
        `${i.displayId ?? ''} ${i.name} ${i.instrumentType} ${i.model ?? ''} ${i.vendor ?? ''} ${i.serialNumber ?? ''} ${i.location ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const sel =
    visible.find((i) => i.id === (search.selected ?? '')) ?? visible.at(0)
  const filtered = Boolean(
    search.q || search.type || search.connection || search.calibration,
  )

  const setParam =
    (key: 'type' | 'connection' | 'calibration') => (value: string) =>
      void navigate({
        to: '/instruments',
        search: (s) => ({
          ...s,
          [key]: value || undefined,
          selected: undefined,
        }),
        replace: true,
      })

  if (search.state === 'denied') {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader title="Instruments" />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title="You don’t have access to the instrument registry"
            body="The registry is open to members of this workspace. Ask a workspace admin to add you."
          >
            <Button nativeButton={false} render={<Link to="/schedule" />}>
              Book an instrument instead
            </Button>
          </EmptyState>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Instruments"
          total={rows.filter((i) => !i.retiredAt).length}
          actions={
            <>
              <Button
                className="max-md:hidden"
                nativeButton={false}
                render={<Link to="/settings/instruments" />}
              >
                Parsers
              </Button>
              <RegisterInstrument
                types={types}
                workspaceId={workspaceId}
                ownerId={context.user.id}
              />
            </>
          }
          tabs={
            <SearchTabs
              label="Instrument lists"
              current={tab}
              items={(
                ['all', 'connected', 'calibration', 'retired'] as const
              ).map((key) => ({
                key,
                label: tabLabels[key],
                count: counts[key],
                link: {
                  to: '/instruments',
                  search: {
                    ...search,
                    tab: key === 'all' ? undefined : key,
                    selected: undefined,
                  },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search instruments"
          placeholder="Search ID, name, model, serial, location"
          onSearch={(next) =>
            void navigate({
              to: '/instruments',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
          right={
            <div className="flex shrink-0 items-center gap-1 max-md:hidden">
              <label className="flex items-center gap-1 text-label text-fg-muted">
                Type
                <Select
                  aria-label="Filter by type"
                  className="h-[26px] w-32 text-label"
                  value={search.type ?? ''}
                  onChange={(e) => setParam('type')(e.target.value)}
                >
                  <option value="">All</option>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-1 text-label text-fg-muted">
                Connection
                <Select
                  aria-label="Filter by connection"
                  className="h-[26px] w-32 text-label"
                  value={search.connection ?? ''}
                  onChange={(e) => setParam('connection')(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="connected">Connected</option>
                  <option value="disconnected">Disconnected</option>
                  <option value="error">Error</option>
                </Select>
              </label>
              <label className="flex items-center gap-1 text-label text-fg-muted">
                Calibration
                <Select
                  aria-label="Filter by calibration"
                  className="h-[26px] w-32 text-label"
                  value={search.calibration ?? ''}
                  onChange={(e) => setParam('calibration')(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="ok">Current</option>
                  <option value="soon">Due in 14 days</option>
                  <option value="overdue">Overdue</option>
                </Select>
              </label>
            </div>
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {visible.length ? (
            <>
              <MobileList
                label="Instruments"
                items={visible.map((i) => {
                  const c = calFor(i.id)
                  const conn = instrumentConnection(i.connectionStatus)
                  return {
                    key: i.id,
                    id: i.displayId ?? i.id.slice(0, 8),
                    title: i.name,
                    sub: `${conn.label} · ${i.location ?? 'No location'}`,
                    selected: i.id === sel?.id,
                    onSelect: () =>
                      void navigate({
                        to: '/instruments',
                        search: (s) => ({ ...s, selected: i.id }),
                        replace: true,
                      }),
                    status:
                      c.state === 'overdue' ? (
                        <span className="text-danger-text">
                          Calibration overdue
                        </span>
                      ) : conn.tone === 'bad' ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Dot tone="bad" />
                          Error
                        </span>
                      ) : c.state === 'soon' ? (
                        <span className="text-warning-text">
                          Calibration {c.label}
                        </span>
                      ) : undefined,
                  }
                })}
              />
              <div className="overflow-x-auto max-md:hidden">
                <Table
                  aria-label="Instruments"
                  className="max-xl:min-w-[1080px]"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead className={stickyHead}>ID</TableHead>
                      <TableHead>Name and type</TableHead>
                      <TableHead>Make and model</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Connection</TableHead>
                      <TableHead>Calibration due</TableHead>
                      <TableHead className="pr-6">Owner</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((i) => {
                      const c = calFor(i.id)
                      const conn = instrumentConnection(i.connectionStatus)
                      return (
                        <TableRow
                          key={i.id}
                          selected={i.id === sel?.id}
                          className="cursor-pointer"
                          onClick={() =>
                            void navigate({
                              to: '/instruments',
                              search: (s) => ({ ...s, selected: i.id }),
                              replace: true,
                            })
                          }
                        >
                          <TableCell className={stickyCell}>
                            <span className="mono">
                              {i.displayId ?? i.id.slice(0, 8)}
                            </span>
                          </TableCell>
                          <TableCell className="py-1.5 leading-[17px]">
                            <span className="block">
                              <Link
                                to="/instruments/$instrumentId"
                                params={{ instrumentId: i.id }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {i.name}
                              </Link>
                            </span>
                            <span className="block text-label text-fg-muted">
                              {i.instrumentType}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[180px] py-1.5 leading-[17px]">
                            <span className="block truncate">
                              {i.model ?? '—'}
                            </span>
                            <span className="block truncate text-label text-fg-muted">
                              {i.vendor ?? '—'}
                            </span>
                          </TableCell>
                          <TableCell>{i.location ?? '—'}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                              <Dot tone={conn.tone} />
                              <span>{conn.label}</span>
                              {i.lastConnectedAt ? (
                                <span className="text-fg-muted">
                                  · {i.lastConnectedAt.slice(0, 10)}
                                </span>
                              ) : null}
                            </span>
                          </TableCell>
                          <TableCell className="py-1.5 leading-[17px]">
                            <span
                              className={cn(
                                'whitespace-nowrap',
                                c.tone === 'bad' && 'text-danger-text',
                                c.tone === 'warn' && 'text-warning-text',
                              )}
                            >
                              {c.label}
                            </span>
                          </TableCell>
                          <TableCell className="pr-6">
                            {i.ownerId ? names.userLabel(i.ownerId) : '—'}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : search.state === 'empty' || rows.length === 0 ? (
            <div className="px-4 md:px-6">
              <EmptyState
                icon="plug"
                title="No instruments registered yet"
                body="Register an instrument to book it, cite it in records and bring its data in by webhook or file drop. Readings from unregistered instruments can only be typed in by hand."
              >
                <RegisterInstrument
                  types={types}
                  workspaceId={workspaceId}
                  ownerId={context.user.id}
                />
              </EmptyState>
            </div>
          ) : (
            <div role="status" className="px-4 md:px-6">
              <EmptyState
                icon="search"
                title={
                  search.q
                    ? `No instruments match “${search.q}”`
                    : `No instruments in ${tabLabels[tab].toLowerCase()}`
                }
                body={
                  filtered
                    ? 'Search looks at ID, name, type, make, model, serial, location and owner.'
                    : tab === 'retired'
                      ? 'Retired instruments stay here with their history so old records still resolve.'
                      : 'Nothing is in this list right now.'
                }
              >
                <Button
                  nativeButton={false}
                  render={
                    <Link to="/instruments" search={{ tab: search.tab }} />
                  }
                >
                  {filtered
                    ? 'Clear search and filters'
                    : 'Show all instruments'}
                </Button>
              </EmptyState>
            </div>
          )}
        </div>
        <ListFooter right={sel ? '1 selected' : undefined}>
          {visible.length} of {counts[tab]}{' '}
          {tab === 'all'
            ? 'instruments in service'
            : tabLabels[tab].toLowerCase()}
        </ListFooter>
      </div>

      {sel ? (
        <InstrumentInspector
          instrument={sel}
          calibration={calFor(sel.id)}
          ownerLabel={sel.ownerId ? names.userLabel(sel.ownerId) : '—'}
          canManage={role === 'owner' || role === 'admin' || role === 'member'}
        />
      ) : null}
    </div>
  )
}

function InstrumentInspector({
  instrument,
  calibration,
  ownerLabel,
  canManage,
}: {
  instrument: InstrumentRow
  calibration: { state: CalibrationState; label: string; tone: string }
  ownerLabel: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const conn = instrumentConnection(instrument.connectionStatus)
  const retire = useMutation({
    mutationFn: (retired: boolean) =>
      setInstrumentRetired(instrument.id, retired),
    onSuccess: (_row, retired) => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      toast(retired ? 'Instrument retired' : 'Instrument reinstated')
    },
    onError: () => toast('Could not change the instrument'),
  })
  return (
    <Inspector aria-label="Instrument details" className="w-[340px] gap-0 p-0">
      <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
        <span className="mono text-fg-muted">
          {instrument.displayId ?? instrument.id.slice(0, 8)} ·{' '}
          {instrument.instrumentType}
        </span>
        <div className="font-heading text-doc font-semibold">
          {instrument.name}
        </div>
        <div className="text-label text-fg-muted">
          {instrument.vendor ?? '—'} {instrument.model ?? ''} · serial{' '}
          {instrument.serialNumber ?? '—'}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="primary"
            nativeButton={false}
            render={
              <Link
                to="/instruments/$instrumentId"
                params={{ instrumentId: instrument.id }}
              />
            }
          >
            Open record
          </Button>
          {!instrument.retiredAt ? (
            <Button
              size="sm"
              nativeButton={false}
              render={<Link to="/schedule" />}
            >
              Book
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-5 px-4 py-3.5">
        {calibration.state === 'overdue' ? (
          <Notice tone="bad" title="Calibration overdue.">
            Data from {instrument.name} is flagged and can’t be cited in GxP
            records until a new certificate is attached.
          </Notice>
        ) : instrument.connectionStatus === 'error' ? (
          <Notice tone="warn" title="Connection error.">
            No data has arrived recently. Check the parser and imports.
          </Notice>
        ) : null}
        <InspectorSection title="Connection">
          <DescriptionList
            labelWidth={96}
            items={[
              [
                'Health',
                <span className="inline-flex items-center gap-1.5">
                  <Dot tone={conn.tone} />
                  {conn.label}
                </span>,
              ],
              [
                'Last connected',
                instrument.lastConnectedAt
                  ? instrument.lastConnectedAt.slice(0, 16).replace('T', ' ')
                  : 'Not tracked yet',
              ],
            ]}
          />
          <Link
            to="/settings/instruments"
            className="mt-1.5 inline-block text-label"
          >
            Parser and imports
          </Link>
        </InspectorSection>
        <InspectorSection title="Use">
          <DescriptionList
            labelWidth={96}
            items={[
              ['Location', instrument.location ?? '—'],
              ['Owner', ownerLabel],
            ]}
          />
        </InspectorSection>
        <InspectorSection title="Calibration">
          <DescriptionList
            labelWidth={96}
            items={[
              [
                'Due',
                <span
                  className={cn(
                    calibration.tone === 'bad' && 'text-danger-text',
                    calibration.tone === 'warn' && 'text-warning-text',
                  )}
                >
                  {calibration.label}
                </span>,
              ],
            ]}
          />
          <Muted className="mt-1.5">
            Certificates and history are on the record.
          </Muted>
        </InspectorSection>
        {canManage ? (
          <InspectorSection title="Registry">
            <Button
              size="sm"
              disabled={retire.isPending}
              onClick={() => retire.mutate(!instrument.retiredAt)}
            >
              {instrument.retiredAt
                ? 'Reinstate instrument'
                : 'Retire instrument'}
            </Button>
            <Muted className="mt-1.5">
              Retired instruments stay for history and can’t be booked.
            </Muted>
          </InspectorSection>
        ) : null}
      </div>
    </Inspector>
  )
}

function RegisterInstrument({
  types,
  workspaceId,
  ownerId,
}: {
  types: string[]
  workspaceId: string
  ownerId: string
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const empty = {
    name: '',
    type: 'qpcr',
    make: '',
    model: '',
    serial: '',
    location: '',
  }
  const [f, setF] = useState(empty)

  const errors = {
    name:
      f.name.trim().length < 2
        ? 'Enter the name on the instrument’s label.'
        : null,
    model: !f.model.trim() ? 'Enter the model.' : null,
    serial: !f.serial.trim()
      ? 'Enter the serial number from the rating plate.'
      : serverError,
    location: !f.location.trim()
      ? 'Enter where it sits, e.g. Lab 2, bench 5.'
      : null,
  }
  const err = (k: keyof typeof errors) =>
    tried || (k === 'serial' && serverError) ? errors[k] : null

  const create = useMutation({
    mutationFn: () =>
      createInstrument({
        workspaceId,
        name: f.name.trim(),
        instrumentType: f.type,
        model: f.model.trim() || null,
        serialNumber: f.serial.trim() || null,
        vendor: f.make.trim() || null,
        location: f.location.trim() || null,
        ownerId,
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      setOpen(false)
      setF(empty)
      setTried(false)
      toast(`${f.name.trim()} registered`, {
        description: `Created ${row.displayId ?? 'the instrument'}.`,
      })
    },
    onError: (e) => {
      setServerError(
        String((e as { message?: string }).message ?? '').includes('serial')
          ? 'An instrument with this serial number is already registered.'
          : 'Could not register the instrument.',
      )
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setF(empty)
          setTried(false)
          setServerError(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="primary" icon="plus" />}>
        Register instrument
      </DialogTrigger>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title="Register instrument"
          description="It can be booked right away; its data is held until a parser is validated."
        />
        <DialogBody>
          <Field label="Name" required error={err('name')}>
            <Input
              autoFocus
              value={f.name}
              aria-invalid={err('name') ? true : undefined}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="e.g. Osmometer OS-02"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type" required>
              <Select
                value={f.type}
                onChange={(e) => setF({ ...f, type: e.target.value })}
              >
                {(types.length
                  ? types
                  : ['qpcr', 'sequencer', 'spectrophotometer', 'other']
                ).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Make" hint="Optional">
              <Input
                value={f.make}
                onChange={(e) => setF({ ...f, make: e.target.value })}
              />
            </Field>
            <Field label="Model" required error={err('model')}>
              <Input
                value={f.model}
                aria-invalid={err('model') ? true : undefined}
                onChange={(e) => setF({ ...f, model: e.target.value })}
              />
            </Field>
            <Field label="Serial number" required error={err('serial')}>
              <Input
                className="mono"
                value={f.serial}
                aria-invalid={err('serial') ? true : undefined}
                onChange={(e) => {
                  setF({ ...f, serial: e.target.value })
                  setServerError(null)
                }}
              />
            </Field>
          </div>
          <Field label="Location" required error={err('location')}>
            <Input
              value={f.location}
              aria-invalid={err('location') ? true : undefined}
              onChange={(e) => setF({ ...f, location: e.target.value })}
              placeholder="e.g. Lab 2, bench 5"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>Cancel</DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setTried(true)
              if (Object.values(errors).some(Boolean)) return
              create.mutate()
            }}
          >
            {create.isPending ? 'Registering…' : 'Register instrument'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
