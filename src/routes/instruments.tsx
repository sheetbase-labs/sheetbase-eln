import { useCallback } from 'react'
import {
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { z } from 'zod'

import { InstrumentUsagePanel } from '#/components/facility/usage-report'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import type { InstrumentRow } from '#/components/instruments/instruments-data'
import { hasCapability } from '#/lib/capability'
import { objectPath } from '#/lib/navigation'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { useInstrumentsList } from './instruments/-instruments-model'
import type { InstrumentsSearch } from './instruments/-instruments-model'
import {
  InstrumentsDenied,
  InstrumentsFilters,
  InstrumentsFooter,
  InstrumentsHeader,
  InstrumentsTable,
} from './instruments/-instruments-list-parts'
import { InstrumentInspector } from './instruments/-instruments-inspector'

export { InstrumentInspector } from './instruments/-instruments-inspector'

export { RegisterInstrument } from './instruments/-instruments-register'

const INSTRUMENT_TABS = z.enum([
  'all',
  'connected',
  'calibration',
  'retired',
  'usage',
])

const INSTRUMENT_STATES = z.enum(['empty', 'denied'])
const OPEN_NEW = z.union([z.literal(true), z.literal('true')])

/** UI port (roadmap-4/ui-app3): the Instruments area (LAB-06). Reads the real
 * instrument registry with its calibration standing; registering and retiring
 * go through the canonical RPCs. */
export const Route = createFileRoute('/instruments')({
  validateSearch: (search): InstrumentsSearch => {
    const isNew = OPEN_NEW.safeParse(search.new)
    const tab = INSTRUMENT_TABS.safeParse(search.tab)
    const q = z.string().safeParse(search.q)
    const type = z.string().safeParse(search.type)
    const connection = z.string().safeParse(search.connection)
    const calibration = z.string().safeParse(search.calibration)
    const selected = z.string().safeParse(search.selected)
    const state = INSTRUMENT_STATES.safeParse(search.state)
    const view: InstrumentsSearch = {}

    if (isNew.success) view.new = true

    if (tab.success) view.tab = tab.data

    if (q.success) view.q = q.data

    if (type.success) view.type = type.data

    if (connection.success) view.connection = connection.data

    if (calibration.success) view.calibration = calibration.data

    if (selected.success) view.selected = selected.data

    if (state.success) view.state = state.data

    return view
  },
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
    }

    return { context }
  },
  component: InstrumentsRoute,
})

/** The instruments area: the list itself, or whatever record is open in it. */
function InstrumentsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/instruments',
  })

  return isIndex ? <InstrumentsList /> : <Outlet />
}

/** The instruments the active tab and filters select, and their counts. */
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

  const list = useInstrumentsList({ search, navigate, context, openInstrument })

  if (search.state === 'denied') {
    return <InstrumentsDenied workspaceId={list.workspaceId} />
  }

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <InstrumentsHeader
          list={list}
          autoOpen={search.new === true}
          onAutoOpened={dropNewFlag}
        />
        {list.tab === 'usage' ? (
          <InstrumentUsagePanel />
        ) : (
          <>
            <InstrumentsFilters list={list} />
            <InstrumentsTable list={list} />
            <InstrumentsFooter list={list} />
          </>
        )}
      </div>

      {list.sel && list.tab !== 'usage' ? (
        <InstrumentInspector
          instrument={list.sel}
          calibration={list.calFor(list.sel.id)}
          ownerLabel={
            list.sel.ownerId ? list.names.userLabel(list.sel.ownerId) : '—'
          }
          canManage={list.canManageInstruments}
          canEditParsers={hasCapability(list.role, 'schema.edit')}
          canRecordCalibration={hasCapability(list.role, 'calibration.record')}
          canImport={hasCapability(list.role, 'record.create')}
          gateMode={list.gateMode}
        />
      ) : null}
    </div>
  )
}
