import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { notebookDataClient } from '#/lib/notebook-data'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import {
  AddedFieldsFormSection,
  useAddedFieldDraft,
  useAddedFieldListColumns,
  withAddedColumns,
} from '#/components/v3/models/added-fields'
import { t } from '#/copy'

/** UI port (roadmap-4/ui-app3): the Instruments area (LAB-06). Reads the real
 * instrument registry with its calibration standing; registering and retiring
 * go through the canonical RPCs. */
const INSTRUMENT_MODEL = requireBuiltInModel('instrument')

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
    new?: true
  } => ({
    new: search.new === true || search.new === 'true' ? true : undefined,
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
  connected: t('library.instruments.list.automaticIntake'),
  calibration: t('library.instruments.list.calibrationDue'),
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
  if (!dueAt)
    return {
      state: 'na',
      label: t('library.instruments.list.notCalibrated'),
      tone: 'none',
    }
  const due = Date.parse(dueAt)
  if (Number.isNaN(due))
    return {
      state: 'na',
      label: t('library.instruments.list.notCalibrated'),
      tone: 'none',
    }
  const days = daysUntilDate(dueAt, now) ?? 0
  const day = formatInstrumentDay(dueAt)
  if (days < 0)
    return {
      state: 'overdue',
      label: t('library.instruments.list.dOverdue', { day, days: -days }),
      tone: 'bad',
    }
  if (days <= CALIBRATION_DUE_SOON_DAYS)
    return {
      state: 'soon',
      label: t('library.instruments.list.dueInD', { day, days }),
      tone: 'warn',
    }
  return { state: 'ok', label: day, tone: 'ok' }
}

function InstrumentsList() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const dropNewFlag = useCallback(() => {
    void navigate({
      search: (current) => ({ ...current, new: undefined }),
      replace: true,
    })
  }, [navigate])
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

  const addedColumns = useAddedFieldListColumns<InstrumentRow>(
    'instrument',
    'id',
  )
  const baseColumns = useMemo<RegistryColumn<InstrumentRow>[]>(
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
        header: t('library.instruments.list.nameAndType'),
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
        header: t('library.instruments.list.makeAndModel'),
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
        header: t('library.instruments.list.howDataGetsIn'),
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
        header: t('library.instruments.list.calibrationDue'),
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
  const columns = useMemo(
    () => withAddedColumns(baseColumns, addedColumns),
    [baseColumns, addedColumns],
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
        <ListHeader title={t('library.instruments.list.instruments')} />
        <div className="px-4 md:px-6">
          <EmptyState
            icon="lock"
            title={t('library.instruments.list.youDontHaveAccessTo')}
            description={
              <>
                {t('library.instruments.list.theRegistryIsOpenTo')}
                <WorkspaceAdminsLine workspaceId={workspaceId} />
              </>
            }
            action={
              <Button nativeButton={false} render={<Link to="/schedule" />}>
                {t('library.instruments.list.bookAnInstrumentInstead')}
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
          title={t('library.instruments.list.instruments')}
          total={query.isPending ? undefined : inService.length}
          actions={
            <>
              <Button
                className="max-md:hidden"
                nativeButton={false}
                render={<Link to="/settings/instruments" />}
              >
                {t('library.instruments.list.parsers')}
              </Button>
              <RegisterInstrument
                types={types}
                workspaceId={workspaceId}
                ownerId={context.user.id}
                autoOpen={search.new === true}
                onAutoOpened={dropNewFlag}
              />
            </>
          }
          tabs={
            <Tabs
              mode="url"
              label={t('library.instruments.list.instrumentLists')}
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
          label={t('library.instruments.list.searchInstruments')}
          placeholder={t('library.instruments.list.searchIdNameModelSerial')}
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
                {t('library.instruments.list.type')}
                <Select
                  aria-label={t('library.instruments.list.filterByType')}
                  className="h-[26px] w-32 text-label"
                  value={search.type ?? ''}
                  onChange={(e) => setParam('type')(e.target.value)}
                >
                  <option value="">{t('library.instruments.list.any')}</option>
                  {types.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-1 text-label text-fg-muted">
                {t('library.instruments.list.howDataGetsIn')}
                <Select
                  aria-label={t('library.instruments.list.filterByHowDataGets')}
                  className="h-[26px] w-32 text-label"
                  value={search.connection ?? ''}
                  onChange={(e) => setParam('connection')(e.target.value)}
                >
                  <option value="">{t('library.instruments.list.any')}</option>
                  {INTAKE_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.title}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-1 text-label text-fg-muted">
                {t('library.instruments.list.calibration')}
                <Select
                  aria-label={t('library.instruments.list.filterByCalibration')}
                  className="h-[26px] w-32 text-label"
                  value={search.calibration ?? ''}
                  onChange={(e) => setParam('calibration')(e.target.value)}
                >
                  <option value="">{t('library.instruments.list.any')}</option>
                  <option value="ok">
                    {t('library.instruments.list.current')}
                  </option>
                  <option value="soon">
                    {t('library.instruments.list.dueInDays', {
                      calibrationDueSoonDays: CALIBRATION_DUE_SOON_DAYS,
                    })}
                  </option>
                  <option value="overdue">
                    {t('library.instruments.list.overdue')}
                  </option>
                </Select>
              </label>
            </div>
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isPending ? (
            <RegistryGrid
              label={t('library.instruments.list.instruments')}
              rows={[]}
              columns={columns}
              getRowId={(i) => i.id}
              selectable={false}
              isLoading
            />
          ) : visible.length ? (
            <>
              <MobileList
                label={t('library.instruments.list.instruments')}
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
                      i.location ?? t('library.instruments.list.noLocation'),
                      i.retiredAt
                        ? t('library.instruments.list.retiredCantBeBooked')
                        : null,
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
                          {t('library.instruments.list.calibrationOverdue')}
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
                          {t('library.instruments.list.calibration2', {
                            label: c.label,
                          })}
                        </span>
                      ) : undefined,
                  }
                })}
              />
              <RegistryGrid
                className="max-md:hidden"
                label={t('library.instruments.list.instruments')}
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
                title={t('library.instruments.list.noInstrumentsRegisteredYet')}
                description={t(
                  'library.instruments.list.registerAnInstrumentToBook',
                )}
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
                    ? t('library.instruments.list.noInstrumentsMatch', {
                        q: search.q,
                      })
                    : t('library.instruments.list.noInstrumentsIn', {
                        toLowerCase: tabLabels[tab].toLowerCase(),
                      })
                }
                description={
                  filtered
                    ? t('library.instruments.list.searchLooksAtIdName')
                    : tab === 'retired'
                      ? t(
                          'library.instruments.list.retiredInstrumentsStayHereWith',
                        )
                      : t('library.instruments.list.nothingIsInThisList')
                }
                action={
                  <Button
                    nativeButton={false}
                    render={
                      <Link to="/instruments" search={{ tab: search.tab }} />
                    }
                  >
                    {filtered
                      ? t('library.instruments.list.clearSearchAndFilters')
                      : t('library.instruments.list.showAllInstruments')}
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
      ? t('library.instruments.list.notBookable')
      : booking.data.next
        ? `${booking.data.next.startsAt.slice(0, 16).replace('T', ' ')} · ${booking.data.next.title}`
        : 'None'
  const parserLabel = !needsParser
    ? t('library.instruments.list.notUsed')
    : parserRows.length
      ? parserRows
          .map(
            (parser) =>
              `${parser.name} · ${parser.validated ? 'validated' : 'not validated'}`,
          )
          .join(', ')
      : t('library.instruments.list.noParserAttached')
  const retire = useMutation({
    mutationFn: (retired: boolean) =>
      setInstrumentRetired(instrument.id, retired),
    onSuccess: (_row, retired) => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      toast(
        retired
          ? t('library.instruments.list.instrumentRetired')
          : t('library.instruments.list.instrumentReinstated'),
      )
    },
    onError: () =>
      toast(t('library.instruments.list.couldNotChangeTheInstrument')),
  })
  const changeMethod = useMutation({
    mutationFn: (method: IntakeMethod) =>
      setInstrumentIntakeMethod(instrument.id, method),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['ui-port', 'instruments'],
      })
      toast(t('library.instruments.list.howDataGetsInUpdated'), {
        description: t('library.instruments.list.dataAlreadyImportedIsNot'),
      })
    },
    onError: () => toast(t('library.instruments.list.couldNotChangeHowData')),
  })
  return (
    <Inspector
      aria-label={t('library.instruments.list.instrumentDetails')}
      className="w-[340px] gap-0 p-0"
    >
      <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
        <span className="mono text-fg-muted">
          {instrument.displayId ?? instrument.id.slice(0, 8)} ·{' '}
          {instrument.instrumentType}
        </span>
        <div className="font-heading text-doc font-semibold">
          {instrument.name}
        </div>
        <div className="text-label text-fg-muted">
          {instrument.vendor ?? '—'} {instrument.model ?? ''}{' '}
          {t('library.instruments.list.serial')}{' '}
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
            {t('library.instruments.list.openRecord')}
          </Button>
          {canRecordCalibration ? (
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link to="/import" search={{ instrument: instrument.id }} />
              }
            >
              {t('common.actions.upload')}
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
              {t('library.instruments.list.book')}
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
                  {t('library.instruments.list.recordCalibration')}
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
        <RegistrySection title={t('library.instruments.list.howDataGetsIn')}>
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
                t('library.instruments.list.lastData'),
                lastDataAt
                  ? lastDataAt.slice(0, 16).replace('T', ' ')
                  : t('library.instruments.list.nothingReceived'),
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
              {t('library.instruments.list.parserAndImports')}
            </Link>
          ) : null}
          {canManage ? (
            <div className="mt-3 flex flex-col gap-1">
              <Select
                aria-label={t('library.instruments.list.howDataGetsIn')}
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
                {t('library.instruments.list.affectsFutureDataOnlyData')}
              </Muted>
            </div>
          ) : null}
        </RegistrySection>
        <RegistrySection title={t('library.instruments.list.use')}>
          <DescriptionList
            labelWidth={96}
            items={[
              [t('library.instruments.list.nextBooking'), nextBooking],
              ['Location', instrument.location ?? '—'],
              ['Owner', ownerLabel],
            ]}
          />
        </RegistrySection>
        <RegistrySection title={t('library.instruments.list.calibration')}>
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
            {t('library.instruments.list.certificatesAndHistoryAreOn')}
          </Muted>
        </RegistrySection>
        {canManage ? (
          <RegistrySection title={t('library.instruments.list.registry')}>
            <Button
              size="sm"
              disabled={retire.isPending}
              onClick={() => retire.mutate(!instrument.retiredAt)}
            >
              {instrument.retiredAt
                ? t('library.instruments.list.reinstateInstrument')
                : t('library.instruments.list.retireInstrument')}
            </Button>
            <Muted className="mt-1.5">
              {t('library.instruments.list.retiredInstrumentsStayForHistory')}
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
  autoOpen = false,
  onAutoOpened,
}: {
  types: string[]
  workspaceId: string
  ownerId: string
  autoOpen?: boolean
  onAutoOpened?: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // The shell's New menu arrives with `?new=true`: the page that owns the flag
  // asks for the dialog to open once, then drops the flag.
  useEffect(() => {
    if (!autoOpen) return
    setOpen(true)
    onAutoOpened?.()
  }, [autoOpen, onAutoOpened])
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
        ? t('library.instruments.list.enterTheNameOnThe')
        : null,
    model: !f.model.trim() ? t('library.instruments.list.enterTheModel') : null,
    serial: !f.serial.trim()
      ? t('library.instruments.list.enterTheSerialNumberFrom')
      : serverError?.field === 'serial'
        ? serverError.message
        : null,
    location: !f.location.trim()
      ? t('library.instruments.list.enterWhereItSitsE')
      : null,
  }
  const err = (k: keyof typeof errors) =>
    tried || (k === 'serial' && serverError?.field === 'serial')
      ? errors[k]
      : null

  const addedFields = useAddedFieldDraft('instrument')
  const create = useMutation({
    mutationFn: async () => {
      const row = await createInstrument({
        workspaceId,
        name: f.name.trim(),
        instrumentType: f.type,
        intakeMethod: f.method,
        model: f.model.trim() || null,
        serialNumber: f.serial.trim() || null,
        vendor: f.make.trim() || null,
        location: f.location.trim() || null,
        ownerId,
      })
      const typed = await saveNewObjectFields(
        notebookDataClient,
        INSTRUMENT_MODEL,
        row.id,
        addedFields.typeKey,
        addedFields.payload(),
      )
      return { ...row, displayId: typed.identifier ?? row.displayId }
    },
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
            ? t('library.instruments.list.createdAttachAValidatedParser', {
                name: row.displayId ?? 'the instrument',
              })
            : f.method === 'webhook'
              ? t('library.instruments.list.createdAttachAValidatedParser2', {
                  name: row.displayId ?? 'the instrument',
                })
              : f.method === 'manual'
                ? t('library.instruments.list.createdReadingsAreTypedIn', {
                    name: row.displayId ?? 'the instrument',
                  })
                : t('library.instruments.list.createdNoDataWillArrive', {
                    name: row.displayId ?? 'the instrument',
                  }),
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
              message: t('library.instruments.list.anInstrumentWithThisSerial'),
            }
          : {
              field: null,
              message: t(
                'library.instruments.list.couldNotRegisterTheInstrument',
              ),
            },
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
        {t('library.instruments.list.registerInstrument')}
      </DialogTrigger>
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader
          title={t('library.instruments.list.registerInstrument')}
          description={
            intakeMethodNeedsParser(f.method)
              ? t('library.instruments.list.itCanBeBookedRight')
              : t('library.instruments.list.itCanBeBookedAnd')
          }
        />
        <DialogBody>
          {serverError && !serverError.field ? (
            <Notice tone="bad" title={serverError.message} />
          ) : null}
          <Field
            label={t('library.instruments.list.name')}
            required
            error={err('name')}
          >
            <Input
              autoFocus
              value={f.name}
              aria-invalid={err('name') ? true : undefined}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder={t('library.instruments.list.eGOsmometerOs02')}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('library.instruments.list.type')} required>
              <Select
                value={f.type}
                onChange={(e) => setF({ ...f, type: e.target.value })}
              >
                {(types.length
                  ? types
                  : ['qpcr', 'sequencer', 'spectrophotometer', 'other']
                ).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('library.instruments.list.make')}
              hint={t('common.states.optional')}
            >
              <Input
                value={f.make}
                onChange={(e) => setF({ ...f, make: e.target.value })}
              />
            </Field>
            <Field
              label={t('library.instruments.list.model')}
              required
              error={err('model')}
            >
              <Input
                value={f.model}
                aria-invalid={err('model') ? true : undefined}
                onChange={(e) => setF({ ...f, model: e.target.value })}
              />
            </Field>
            <Field
              label={t('library.instruments.list.serialNumber')}
              required
              error={err('serial')}
            >
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
          <Field
            label={t('library.instruments.list.location')}
            required
            error={err('location')}
          >
            <Input
              value={f.location}
              aria-invalid={err('location') ? true : undefined}
              onChange={(e) => setF({ ...f, location: e.target.value })}
              placeholder={t('library.instruments.list.eGLab2Bench')}
            />
          </Field>
          <RadioGroup
            aria-label={t('library.instruments.list.howDataGetsIn')}
            value={f.method}
            onValueChange={(value) =>
              setF({ ...f, method: value as IntakeMethod })
            }
          >
            <span className="text-label font-medium text-fg">
              {t('library.instruments.list.howDataGetsIn')}
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
          <AddedFieldsFormSection draft={addedFields} showErrors={tried} />
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" />}>
            {t('common.actions.cancel')}
          </DialogClose>
          <Button
            variant="primary"
            disabled={create.isPending}
            onClick={() => {
              setTried(true)
              if (Object.values(errors).some(Boolean) || !addedFields.valid)
                return
              create.mutate()
            }}
          >
            {create.isPending
              ? t('library.instruments.list.registering')
              : t('library.instruments.list.registerInstrument')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
