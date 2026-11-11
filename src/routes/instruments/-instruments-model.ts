/**
 * The Instruments registry's reads, tab counts, filters and columns.
 *
 * The route file describes the screen; this module owns which tab and filters
 * are in view, what each tab counts, and the registry columns the list, its
 * menu and its export share. Its inspector keeps its own model.
 */
import { useCallback, useMemo } from 'react'

import { useAddedFieldListColumns } from '#/components/models/added-fields'
import { withAddedColumns } from '#/components/models/added-field-columns'
import { useRowFocus } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { calibrationState } from '#/components/instruments/calibration-standing'
import {
  INTAKE_METHODS,
  intakeHealth,
  useInstruments,
  useLastImportsByInstrument,
  useLatestCalibrationsByInstrument,
  useParserReadinessByInstrument,
} from '#/components/instruments/instruments-data'
import type {
  InstrumentRow,
  IntakeMethod,
} from '#/components/instruments/instruments-data'
import { useInstrumentGateMode } from '#/lib/instrument-gate'
import { useListView } from '#/lib/list-views'
import { canManageSettings } from '#/lib/settings-access'
import type { SettingsAccessMap } from '#/lib/settings-access'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'
import { instrumentColumns } from './-instruments-columns'

/** The Instruments screen's search: the tab in view, the filters applied, and any named instrument. */
export interface InstrumentsSearch {
  tab?: 'all' | 'connected' | 'calibration' | 'retired' | 'usage'
  q?: string
  type?: string
  connection?: string
  calibration?: string
  selected?: string
  state?: 'empty' | 'denied'
  new?: true
}

/** One of the registry's tabs. */
export type InstrumentsTab = NonNullable<InstrumentsSearch['tab']>

export const tabLabels = {
  all: 'All',
  connected: t('library.instruments.list.automaticIntake'),
  calibration: t('library.instruments.list.calibrationDue'),
  retired: 'Retired',
  usage: t('spend.usage.tab'),
} as const

/** What the footer's "x of y …" counts, one phrase per tab. */
export const tabCountLabels: Record<InstrumentsTab, string> = {
  all: 'instruments in service',
  connected: 'instruments taking automatic intake',
  calibration: 'instruments with a calibration due',
  retired: 'retired instruments',
  usage: 'instruments',
}

/** The workspace and person the registry reads on behalf of. */
export interface InstrumentsContext {
  workspace?: {
    id?: string
    role?: string | null
    settingsAccess?: SettingsAccessMap
  } | null
  user: { id: string; name: string }
}

/**
 * The list's writes to the URL: one updater over the search it already holds.
 * Narrowed to the calls this screen makes, so the route's own navigate fits.
 */
export type InstrumentsNavigate = (options: {
  to?: '/instruments'
  search?: (current: InstrumentsSearch) => InstrumentsSearch
  replace?: boolean
}) => Promise<void>

/** The intake method an offered choice names, or nothing when it is not one of them. */
export function intakeMethodOf(value: string): IntakeMethod | null {
  return INTAKE_METHODS.find((method) => method.value === value)?.value ?? null
}

/** The calibration standing of one instrument, as its column and inspector read it. */
type StandingOf = (id: string) => ReturnType<typeof calibrationState>

/** What each tab counts: the rows that tab lists, not every row in the table. */
export function instrumentTabCounts(
  rows: InstrumentRow[],
  standingOf: StandingOf,
): Record<InstrumentsTab, number> {
  return {
    // "All" is the in-service registry: retired instruments have their own tab.
    all: rows.filter((i) => !i.retiredAt).length,
    connected: rows.filter(
      (i) =>
        !i.retiredAt &&
        (i.intakeMethod === 'filedrop' || i.intakeMethod === 'webhook'),
    ).length,
    calibration: rows.filter((i) => {
      if (i.retiredAt) return false

      const c = standingOf(i.id).state

      return c === 'overdue' || c === 'soon' || c === 'na'
    }).length,
    retired: rows.filter((i) => i.retiredAt).length,
    usage: 0,
  }
}

/** The instruments the active tab and filters select. */
export function visibleInstruments(input: {
  rows: InstrumentRow[]
  tab: InstrumentsTab
  search: InstrumentsSearch
  standingOf: StandingOf
}): InstrumentRow[] {
  const { rows, tab, search, standingOf } = input
  const q = (search.q ?? '').trim().toLowerCase()

  return rows.filter((i) => {
    if (
      tab === 'connected' &&
      (i.retiredAt ||
        (i.intakeMethod !== 'filedrop' && i.intakeMethod !== 'webhook'))
    )
      return false

    if (tab === 'calibration') {
      const c = standingOf(i.id).state

      if (i.retiredAt || (c !== 'overdue' && c !== 'soon' && c !== 'na'))
        return false
    }

    if (tab === 'retired' && !i.retiredAt) return false

    if (tab === 'all' && i.retiredAt) return false

    if (search.type && i.instrumentType !== search.type) return false

    if (search.connection && i.intakeMethod !== search.connection) return false

    if (search.calibration && standingOf(i.id).state !== search.calibration)
      return false

    if (q) {
      const hay =
        `${i.displayId ?? ''} ${i.name} ${i.instrumentType} ${i.model ?? ''} ${i.vendor ?? ''} ${i.serialNumber ?? ''} ${i.location ?? ''}`.toLowerCase()

      if (!hay.includes(q)) return false
    }

    return true
  })
}

/** Everything the registry list reads, derives and writes. */
export function useInstrumentsList(input: {
  search: InstrumentsSearch
  navigate: InstrumentsNavigate
  context: InstrumentsContext
  openInstrument: (instrument: InstrumentRow, event?: React.MouseEvent) => void
}) {
  const { search, navigate, context, openInstrument } = input
  const workspaceId = context.workspace?.id ?? ''

  const gateMode = useInstrumentGateMode(workspaceId)

  const query = useInstruments()

  const calibrations = useLatestCalibrationsByInstrument()

  const imports = useLastImportsByInstrument()

  const parserReadiness = useParserReadinessByInstrument()

  const rows = query.data ?? []

  const role = context.workspace?.role

  // Registering, retiring and setting up instruments follows the Instruments
  // row on the Roles page; the database checks the same rule.
  const canManageInstruments = canManageSettings(
    context.workspace,
    'instruments',
  )

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
    () => [...new Set((query.data ?? []).map((i) => i.instrumentType))].sort(),
    [query.data],
  )

  const tab = search.tab ?? 'all'

  const inService = rows.filter((i) => !i.retiredAt)

  const counts = instrumentTabCounts(rows, calFor)

  const visible = visibleInstruments({ rows, tab, search, standingOf: calFor })

  const sel =
    visible.find((i) => i.id === (search.selected ?? '')) ?? visible.at(0)

  const filtered = Boolean(
    search.q || search.type || search.connection || search.calibration,
  )

  const setParam = useCallback(
    (key: 'type' | 'connection' | 'calibration') => (value: string) =>
      void navigate({
        to: '/instruments',
        search: (s) => ({
          ...s,
          [key]: value || undefined,
          selected: undefined,
        }),
        replace: true,
      }),
    [navigate],
  )

  const addedColumns = useAddedFieldListColumns<InstrumentRow>(
    'instrument',
    'id',
  )

  const baseColumns = useMemo<RegistryColumn<InstrumentRow>[]>(
    () =>
      instrumentColumns({
        latest: calibrations.data,
        lastImports: imports.data,
        readiness: parserReadiness.data,
        parserReadyKnown: parserReadiness.isSuccess,
        names,
        openInstrument,
      }),
    [
      calibrations.data,
      imports.data,
      parserReadiness.data,
      parserReadiness.isSuccess,
      names,
      openInstrument,
    ],
  )

  const view = useListView('instruments')

  const columns = useMemo(
    () => withAddedColumns(baseColumns, addedColumns),
    [baseColumns, addedColumns],
  )

  const selectRow = useCallback(
    (id: string | null) =>
      void navigate({
        to: '/instruments',
        search: (s) => ({ ...s, selected: id ?? undefined }),
        replace: true,
      }),
    [navigate],
  )

  const { rowSelection, onRowSelectionChange } = useRowFocus(
    sel?.id ?? null,
    selectRow,
  )

  return {
    query,
    search,
    rows,
    visible,
    sel,
    tab,
    counts,
    filtered,
    types,
    names,
    columns,
    view,
    rowSelection,
    onRowSelectionChange,
    canManageInstruments,
    gateMode,
    healthFor,
    calFor,
    workspaceId,
    ownerId: context.user.id,
    role,
    inService,
    openInstrument,
    navigate,
    setParam,
  }
}

/** What the registry list's sections read and call. */
export type InstrumentsListModel = ReturnType<typeof useInstrumentsList>
