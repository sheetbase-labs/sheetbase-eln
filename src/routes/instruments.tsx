import { useMemo, useState } from 'react'
import { WorkspaceAdminsLine } from '#/components/v3/settings/workspace-admins-line'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Dot } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { DescriptionList, Inspector, Muted } from '#/components/v3/ui/layout'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { objectPath } from '#/lib/navigation'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Choice } from '#/components/v3/ui/choice'
import { RadioGroup } from '#/components/v3/ui/radio-group'
import { Notice } from '#/components/v3/ui/alert'
import { CalibrationOverdueNotice } from '#/components/v3/instruments/calibration-overdue'
import {
  IntakeDeliveryNotice,
  intakeDeliveryProblem,
} from '#/components/v3/instruments/intake-delivery-notice'
import { ParserFollowUpNotice } from '#/components/v3/instruments/parser-follow-up'
import { hasCapability } from '#/lib/capability'
import { Select } from '#/components/v3/ui/select'
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
} from '#/components/v3/inventory/list'
import { Tabs } from '#/components/v3/ui/tabs'
import {
  CALIBRATION_DUE_SOON_DAYS,
  INTAKE_METHODS,
  createInstrument,
  formatInstrumentDay,
  intakeHealth,
  intakeMethodLabel,
  intakeMethodNeedsParser,
  parserFollowUp,
  setInstrumentIntakeMethod,
  setInstrumentRetired,
  useInstrumentLastImport,
  useInstrumentNextBooking,
  useInstrumentParsers,
  useInstruments,
  useLastImportsByInstrument,
  useLatestCalibrationsByInstrument,
  useParserReadinessByInstrument,
} from '#/components/v3/instruments/instruments-data'
import type {
  InstrumentRow,
  IntakeMethod,
} from '#/components/v3/instruments/instruments-data'
import { useUserNames } from '#/lib/user-names'
import { cn } from '#/lib/utils'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { now as appNow } from '#/lib/clock'
import { daysUntilDate } from '#/lib/calendar-days'

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
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: InstrumentsRoute,
})

const tabLabels = {
  all: 'All',
  connected: 'Automatic intake',
  calibration: 'Calibration due',
  retired: 'Retired',
} as const

/** What the footer's "x of y …" counts, one phrase per tab. */
const tabCountLabels: Record<keyof typeof tabLabels, string> = {
  all: 'instruments in service',
  connected: 'instruments taking automatic intake',
  calibration: 'instruments with a calibration due',
  retired: 'retired instruments',
}

function InstrumentsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/instruments',
  })
  return isIndex ? <InstrumentsList /> : <Outlet />
}

type CalibrationState = 'ok' | 'soon' | 'overdue' | 'na'

/** The registry's calibration due column and its Calibration tab. */
export function calibrationState(
  dueAt: string | null | undefined,
  now: Date = appNow(),
): {
  state: CalibrationState
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'none'
} {
  if (!dueAt) return { state: 'na', label: 'Not calibrated', tone: 'none' }
  const due = Date.parse(dueAt)
  if (Number.isNaN(due))
    return { state: 'na', label: 'Not calibrated', tone: 'none' }
  const days = daysUntilDate(dueAt, now) ?? 0
  const day = formatInstrumentDay(dueAt)
  if (days < 0)
    return {
      state: 'overdue',
      label: `${day} · ${-days} d overdue`,
      tone: 'bad',
    }
  if (days <= CALIBRATION_DUE_SOON_DAYS)
    return {
      state: 'soon',
      label: `${day} · due in ${days} d`,
      tone: 'warn',
    }
  return { state: 'ok', label: day, tone: 'ok' }
}

function InstrumentsList() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const openInstrument = useOpenRow<InstrumentRow>(
    navigate,
    (row) => objectPath('instrument', row.id),
    (row) => row.name,
  )
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const query = useInstruments()
  const calibrations = useLatestCalibrationsByInstrument()
  const imports = useLastImportsByInstrument()
  const parserReadiness = useParserReadinessByInstrument()
  const rows = query.data ?? []
  const role = context.workspace?.role

  const latest = calibrations.data ?? new Map()
  const lastImports = imports.data ?? new Map()
  // The inspector reports health from the parser's own state, so the list does too:
  // an automated method with no validated parser is "Parser not validated" here as
  // well, not "Waiting for first data". Until the parsers load, the list passes no
  // opinion and falls back to the import evidence.
  const readiness = parserReadiness.data
  const healthFor = (instrument: InstrumentRow) =>
    intakeHealth(instrument.intakeMethod, {
      parserReady: parserReadiness.isSuccess
        ? (readiness?.get(instrument.id) ?? false)
        : undefined,
      lastImport: lastImports.get(instrument.id) ?? null,
    })
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
  // "All" is the in-service registry: retired instruments have their own tab, so the
  // count must be the rows the tab's list shows, not every row in the table.
  const inService = rows.filter((i) => !i.retiredAt)
  const counts = {
    all: inService.length,
    connected: rows.filter(
      (i) =>
        !i.retiredAt &&
        (i.intakeMethod === 'filedrop' || i.intakeMethod === 'webhook'),
    ).length,
    calibration: rows.filter((i) => {
      if (i.retiredAt) return false
      const c = calFor(i.id).state
      return c === 'overdue' || c === 'soon' || c === 'na'
    }).length,
    retired: rows.filter((i) => i.retiredAt).length,
  }

  const q = (search.q ?? '').trim().toLowerCase()
  const visible = rows.filter((i) => {
    if (
      tab === 'connected' &&
      (i.retiredAt ||
        (i.intakeMethod !== 'filedrop' && i.intakeMethod !== 'webhook'))
    )
      return false
    if (tab === 'calibration') {
      const c = calFor(i.id).state
      if (i.retiredAt || (c !== 'overdue' && c !== 'soon' && c !== 'na'))
        return false
    }
    if (tab === 'retired' && !i.retiredAt) return false
    if (tab === 'all' && i.retiredAt) return false
    if (search.type && i.instrumentType !== search.type) return false
    if (search.connection && i.intakeMethod !== search.connection) return false
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

  const columns = useMemo<RegistryColumn<InstrumentRow>[]>(
    () => [
      {
        id: 'identifier',
        header: 'ID',
        cell: ({ row }) => (
          <span className="mono">
            {row.original.displayId ?? row.original.id.slice(0, 8)}
          </span>
        ),
      },
      {
        id: 'name',
        header: 'Name and type',
        // The grid zeroes a cell's own vertical padding, so a two-line cell
        // carries its line height and padding on its content instead. The
        // bespoke body's two-line rows were 46px, and stay 46px.
        cell: ({ row }) => (
          <span className="block py-1.5 leading-[17px]">
            <span className="block">
              <Link
                to="/instruments/$instrumentId"
                params={{ instrumentId: row.original.id }}
                onClick={(event) => openInstrument(row.original, event)}
              >
                {row.original.name}
              </Link>
            </span>
            <span className="block text-label text-fg-muted">
              {row.original.instrumentType}
            </span>
          </span>
        ),
      },
      {
        id: 'model',
        header: 'Make and model',
        meta: { cellClassName: 'max-w-[180px]' },
        cell: ({ row }) => (
          <span className="block py-1.5 leading-[17px]">
            <span className="block truncate">{row.original.model ?? '—'}</span>
            <span className="block truncate text-label text-fg-muted">
              {row.original.vendor ?? '—'}
            </span>
          </span>
        ),
      },
      {
        id: 'location',
        header: 'Location',
        cell: ({ row }) => row.original.location ?? '—',
      },
      {
        id: 'intake',
        header: 'How data gets in',
        cell: ({ row }) => {
          const health = healthFor(row.original)
          return (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Dot tone={health.tone} />
              <span>{intakeMethodLabel(row.original.intakeMethod)}</span>
              {health.tone === 'bad' || health.tone === 'warn' ? (
                <span
                  className={cn(
                    'text-fg-muted',
                    health.tone === 'bad' && 'text-danger-text',
                    health.tone === 'warn' && 'text-warning-text',
                  )}
                >
                  · {health.label}
                </span>
              ) : null}
            </span>
          )
        },
      },
      {
        id: 'calibration',
        header: 'Calibration due',
        meta: { cellClassName: 'py-1.5 leading-[17px]' },
        cell: ({ row }) => {
          const c = calFor(row.original.id)
          return (
            <span
              // The date is in the tooltip; the cell keeps the part that matters
              // ("40 d overdue") so the column fits a third-width pane.
              title={c.label}
              className={cn(
                'whitespace-nowrap',
                c.tone === 'bad' && 'text-danger-text',
                c.tone === 'warn' && 'text-warning-text',
              )}
            >
              {c.label.split(' · ').at(-1)}
            </span>
          )
        },
      },
      {
        id: 'owner',
        header: 'Owner',
        // The grid owns cell padding (`px-2.5` on every cell), so a column's
        // own trailing space has to be requested explicitly — this column was
        // the last one in the table before the swap and carried `pr-6`.
        meta: { headerClassName: 'pr-6!', cellClassName: 'pr-6!' },
        cell: ({ row }) =>
          row.original.ownerId ? names.userLabel(row.original.ownerId) : '—',
      },
    ],
    // Rebuilt with the evidence the cells read — the owner labels, and the
    // calibration and intake maps — so a late arrival cannot leave a stale
    // cell behind.
    [
      names,
      latest,
      lastImports,
      readiness,
      parserReadiness.isSuccess,
      openInstrument,
    ],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.id ?? null,
    (id) =>
      void navigate({
        to: '/instruments',
        search: (s) => ({ ...s, selected: id ?? undefined }),
        replace: true,
      }),
  )

  if (search.state === 'denied') {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader title="Instruments" />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title="You don’t have access to the instrument registry"
            description={
              <>
                The registry is open to members of this workspace. Ask a
                workspace admin to add you.
                <WorkspaceAdminsLine workspaceId={workspaceId} />
              </>
            }
            action={
              <Button nativeButton={false} render={<Link to="/schedule" />}>
                Book an instrument instead
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Instruments"
          total={query.isPending ? undefined : inService.length}
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
            <Tabs
              mode="url"
              label="Instrument lists"
              value={tab}
              items={(
                ['all', 'connected', 'calibration', 'retired'] as const
              ).map((key) => ({
                key,
                label: tabLabels[key],
                count: query.isPending ? undefined : counts[key],
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
                  <option value="">Any</option>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-1 text-label text-fg-muted">
                How data gets in
                <Select
                  aria-label="Filter by how data gets in"
                  className="h-[26px] w-32 text-label"
                  value={search.connection ?? ''}
                  onChange={(e) => setParam('connection')(e.target.value)}
                >
                  <option value="">Any</option>
                  {INTAKE_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.title}
                    </option>
                  ))}
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
                  <option value="">Any</option>
                  <option value="ok">Current</option>
                  <option value="soon">
                    Due in {CALIBRATION_DUE_SOON_DAYS} days
                  </option>
                  <option value="overdue">Overdue</option>
                </Select>
              </label>
            </div>
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isPending ? (
            <RegistryGrid
              label="Instruments"
              rows={[]}
              columns={columns}
              getRowId={(i) => i.id}
              selectable={false}
              isLoading
            />
          ) : visible.length ? (
            <>
              <MobileList
                label="Instruments"
                items={visible.map((i) => {
                  const c = calFor(i.id)
                  const health = healthFor(i)
                  return {
                    key: i.id,
                    id: i.displayId ?? i.id.slice(0, 8),
                    title: i.name,
                    // A phone has no table column for the registry state, so the row says
                    // whether the instrument can be booked rather than leaving that to the
                    // inspector or the Schedule page.
                    sub: [
                      intakeMethodLabel(i.intakeMethod),
                      i.location ?? 'No location',
                      i.retiredAt ? 'Retired — can’t be booked' : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    selected: i.id === sel?.id,
                    link: {
                      to: '/instruments/$instrumentId',
                      params: { instrumentId: i.id },
                      onClick: (event: React.MouseEvent) =>
                        openInstrument(i, event),
                    },
                    status:
                      c.state === 'overdue' ? (
                        <span className="text-danger-text">
                          Calibration overdue
                        </span>
                      ) : health.tone === 'bad' ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Dot tone="bad" />
                          {health.label}
                        </span>
                      ) : health.tone === 'warn' ? (
                        <span className="text-warning-text">
                          {health.label}
                        </span>
                      ) : c.state === 'soon' ? (
                        <span className="text-warning-text">
                          Calibration {c.label}
                        </span>
                      ) : undefined,
                  }
                })}
              />
              <RegistryGrid
                className="max-md:hidden"
                label="Instruments"
                rows={visible}
                columns={columns}
                getRowId={(i) => i.id}
                rowSelection={rowSelection}
                onRowSelectionChange={onRowSelectionChange}
                onRowClick={openInstrument}
                isLoading={query.isPending}
              />
            </>
          ) : search.state === 'empty' || rows.length === 0 ? (
            <div className="px-4 md:px-6">
              <EmptyState
                icon="plug"
                title="No instruments registered yet"
                description="Register an instrument to book it, cite it in records and bring its data in by webhook or file drop. Readings from unregistered instruments can only be typed in by hand."
                action={
                  <RegisterInstrument
                    types={types}
                    workspaceId={workspaceId}
                    ownerId={context.user.id}
                  />
                }
              />
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
                description={
                  filtered
                    ? 'Search looks at ID, name, type, make, model, serial, location and owner.'
                    : tab === 'retired'
                      ? 'Retired instruments stay here with their history so old records still resolve.'
                      : 'Nothing is in this list right now.'
                }
                action={
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
                }
              />
            </div>
          )}
        </div>
        <ListFooter
          loading={query.isPending}
          right={sel ? '1 selected' : undefined}
        >
          {visible.length} of {counts[tab]} {tabCountLabels[tab]}
        </ListFooter>
      </div>

      {sel ? (
        <InstrumentInspector
          instrument={sel}
          calibration={calFor(sel.id)}
          ownerLabel={sel.ownerId ? names.userLabel(sel.ownerId) : '—'}
          canManage={role === 'owner' || role === 'admin' || role === 'member'}
          canEditParsers={hasCapability(role, 'schema.edit')}
          canRecordCalibration={hasCapability(role, 'record.create')}
        />
      ) : null}
    </div>
  )
}

/**
 * The inspector's sections are the registry page's top-level sections, so they
 * are h2 — `InspectorSection` is h3-only and belongs inside an already-titled
 * page. Same label typography, one level up.
 */
function RegistrySection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-1.5 font-sans text-label font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function InstrumentInspector({
  instrument,
  calibration,
  ownerLabel,
  canManage,
  canEditParsers,
  canRecordCalibration = false,
}: {
  instrument: InstrumentRow
  calibration: { state: CalibrationState; label: string; tone: string }
  ownerLabel: string
  canManage: boolean
  canEditParsers: boolean
  canRecordCalibration?: boolean
}) {
  const queryClient = useQueryClient()
  const parsers = useInstrumentParsers(instrument.id)
  const lastImport = useInstrumentLastImport(instrument.id)
  const booking = useInstrumentNextBooking(instrument.id)
  const parserRows = parsers.data ?? []
  const parserReady =
    parserRows.length > 0 && parserRows.some((parser) => parser.validated)
  const needsParser = intakeMethodNeedsParser(instrument.intakeMethod)
  const followUp = parserFollowUp(
    instrument.id,
    instrument.intakeMethod,
    parsers.data,
  )
  const health = intakeHealth(instrument.intakeMethod, {
    parserReady: parsers.isSuccess ? parserReady : undefined,
    lastImport: lastImport.data ?? null,
  })
  const deliveryProblem = intakeDeliveryProblem(health.label)
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
  const changeMethod = useMutation({
    mutationFn: (method: IntakeMethod) =>
      setInstrumentIntakeMethod(instrument.id, method),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      toast('How data gets in updated', {
        description:
          'Imports already committed keep the provenance they arrived with.',
      })
    },
    onError: () => toast('Could not change how data gets in'),
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
          {canRecordCalibration ? (
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link to="/import" search={{ instrument: instrument.id }} />
              }
            >
              Upload
            </Button>
          ) : null}
          {!instrument.retiredAt ? (
            <Button
              size="sm"
              nativeButton={false}
              // The Schedule opens its book dialog with this instrument already
              // chosen, so the registry does not send the person back to a list
              // to find the instrument they were just looking at.
              render={<Link to="/schedule" search={{ book: instrument.id }} />}
            >
              Book
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-5 px-4 py-3.5">
        {calibration.state === 'overdue' ? (
          <CalibrationOverdueNotice
            instrumentName={instrument.name}
            action={
              canRecordCalibration ? (
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link
                      to="/instruments/$instrumentId"
                      params={{ instrumentId: instrument.id }}
                      search={{ record: '1' }}
                    />
                  }
                >
                  Record calibration
                </Button>
              ) : undefined
            }
          />
        ) : followUp ? (
          <ParserFollowUpNotice
            instrumentName={instrument.name}
            followUp={followUp}
            canEdit={canEditParsers}
          />
        ) : deliveryProblem ? (
          <IntakeDeliveryNotice
            instrumentId={instrument.id}
            instrumentName={instrument.name}
            problem={deliveryProblem}
            canImport={canRecordCalibration}
          />
        ) : null}
        <RegistrySection title="How data gets in">
          <DescriptionList
            labelWidth={96}
            items={[
              ['Method', intakeMethodLabel(instrument.intakeMethod)],
              [
                'Health',
                <span className="inline-flex items-center gap-1.5">
                  <Dot tone={health.tone} />
                  {health.label}
                </span>,
              ],
              [
                'Last data',
                lastDataAt
                  ? lastDataAt.slice(0, 16).replace('T', ' ')
                  : 'Nothing received',
              ],
              ['Parser', parserLabel],
            ]}
          />
          {needsParser ? (
            <Link
              to="/settings/instruments"
              search={{ instrumentId: instrument.id }}
              className="mt-1.5 inline-block text-label text-link hover:underline"
            >
              Parser and imports
            </Link>
          ) : null}
          {canManage ? (
            <div className="mt-3 flex flex-col gap-1">
              <Select
                aria-label="How data gets in"
                className="h-[26px] text-label"
                value={instrument.intakeMethod}
                disabled={changeMethod.isPending}
                onChange={(e) =>
                  changeMethod.mutate(e.target.value as IntakeMethod)
                }
              >
                {INTAKE_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.title}
                  </option>
                ))}
              </Select>
              <Muted>
                Affects future data only. Imports already committed keep the
                parser and source provenance they arrived with.
              </Muted>
            </div>
          ) : null}
        </RegistrySection>
        <RegistrySection title="Use">
          <DescriptionList
            labelWidth={96}
            items={[
              ['Next booking', nextBooking],
              ['Location', instrument.location ?? '—'],
              ['Owner', ownerLabel],
            ]}
          />
        </RegistrySection>
        <RegistrySection title="Calibration">
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
        </RegistrySection>
        {canManage ? (
          <RegistrySection title="Registry">
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
          </RegistrySection>
        ) : null}
      </div>
    </Inspector>
  )
}

export function RegisterInstrument({
  types,
  workspaceId,
  ownerId,
}: {
  types: string[]
  workspaceId: string
  ownerId: string
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tried, setTried] = useState(false)
  // A refusal usually belongs to the form, not to one field: only a serial clash is
  // about the serial number, everything else (permission, workspace) shows at the top.
  const [serverError, setServerError] = useState<{
    field: 'serial' | null
    message: string
  } | null>(null)
  const empty = {
    name: '',
    type: 'qpcr',
    make: '',
    model: '',
    serial: '',
    location: '',
    method: 'filedrop' as IntakeMethod,
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
      : serverError?.field === 'serial'
        ? serverError.message
        : null,
    location: !f.location.trim()
      ? 'Enter where it sits, e.g. Lab 2, bench 5.'
      : null,
  }
  const err = (k: keyof typeof errors) =>
    tried || (k === 'serial' && serverError?.field === 'serial')
      ? errors[k]
      : null

  const create = useMutation({
    mutationFn: () =>
      createInstrument({
        workspaceId,
        name: f.name.trim(),
        instrumentType: f.type,
        intakeMethod: f.method,
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
        description:
          f.method === 'filedrop'
            ? `Created ${row.displayId ?? 'the instrument'}. Attach a validated parser to import its files.`
            : f.method === 'webhook'
              ? `Created ${row.displayId ?? 'the instrument'}. Attach a validated parser before its posts can import.`
              : f.method === 'manual'
                ? `Created ${row.displayId ?? 'the instrument'}. Readings are typed in and carry who entered them.`
                : `Created ${row.displayId ?? 'the instrument'}. No data will arrive until you connect it.`,
      })
      // Land on the new instrument, where parser, calibration and intake are set up.
      void navigate({
        to: '/instruments/$instrumentId',
        params: { instrumentId: row.id },
      })
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e)
      setServerError(
        message.includes('serial')
          ? {
              field: 'serial',
              message:
                'An instrument with this serial number is already registered.',
            }
          : { field: null, message: 'Could not register the instrument.' },
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
          description={
            intakeMethodNeedsParser(f.method)
              ? 'It can be booked right away; its data is held until a validated parser is attached.'
              : 'It can be booked and cited right away.'
          }
        />
        <DialogBody>
          {serverError && !serverError.field ? (
            <Notice tone="bad" title={serverError.message} />
          ) : null}
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
          <RadioGroup
            aria-label="How data gets in"
            value={f.method}
            onValueChange={(value) =>
              setF({ ...f, method: value as IntakeMethod })
            }
          >
            <span className="text-label font-medium text-fg">
              How data gets in
            </span>
            {INTAKE_METHODS.map((method) => (
              <Choice
                key={method.value}
                value={method.value}
                title={method.title}
              >
                {method.consequence}
              </Choice>
            ))}
          </RadioGroup>
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
