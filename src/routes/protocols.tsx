import { useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'

import { Button } from '#/components/v3/ui/button'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Status } from '#/components/v3/ui/status'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/v3/ui/layout'
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  footerCount,
} from '#/components/v3/inventory/list'
import {
  ProtocolsRegistryGrid,
  protocolStatus,
} from '#/components/v3/protocols/protocols-registry-grid'
import { useRowFocus } from '#/components/v3/inventory/registry-grid'
import { Tabs } from '#/components/v3/ui/tabs'
import { NewProtocolDialog } from '#/components/v3/protocols/new-protocol-dialog'
import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookRecord } from '#/lib/notebook-data'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { fetchTemplates } from '#/lib/templates'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'

const tabs = ['effective', 'mine', 'inreview', 'reviewdue', 'archived'] as const
type ProtocolTab = (typeof tabs)[number]
/** The orderings the list offers. These template records carry no effective
 * date — the reference's Effective column has no model behind it, and
 * controlled versions with one are a later capability — so the menu offers the
 * keys the route can actually apply. */
const sorts = ['Updated', 'ID', 'Protocol'] as const
type ProtocolSort = (typeof sorts)[number]
const tabLabel: Record<ProtocolTab, string> = {
  effective: 'Effective',
  mine: 'Mine',
  inreview: 'In review',
  reviewdue: 'Review due',
  archived: 'Archived',
}

/** The orderings the toolbar offers, as the grid's sorting state. The route
 * owns the menu; the table owns the order, so a header click and a menu pick
 * are the same single source. */
const SORTS: Record<ProtocolSort, SortingState> = {
  Updated: [{ id: 'updatedAt', desc: true }],
  ID: [{ id: 'identifier', desc: false }],
  Protocol: [{ id: 'title', desc: false }],
}

/** The menu key a sorting state came from, or undefined when the user sorted
 * by a column the menu does not list. */
function sortKeyOf(sorting: SortingState): ProtocolSort | undefined {
  const first = sorting.at(0)
  if (!first) return undefined
  return (Object.keys(SORTS) as ProtocolSort[]).find((key) => {
    const entry = SORTS[key].at(0)
    return (
      entry !== undefined && entry.id === first.id && entry.desc === first.desc
    )
  })
}

/** UI port (roadmap-4/ui-app3): the Protocols list on protocol-template
 * records. Controlled versions, training and approval chains are later
 * capabilities; this list shows the records that exist today. */
export const Route = createFileRoute('/protocols')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; tab?: ProtocolTab; selected?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    selected: typeof search.selected === 'string' ? search.selected : undefined,
    tab: (tabs as readonly string[]).includes(search.tab as string)
      ? (search.tab as ProtocolTab)
      : undefined,
  }),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: ProtocolsRoute,
})

function ProtocolsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/protocols',
  })
  return isIndex ? <ProtocolsList /> : <Outlet />
}

interface ProtocolTabInput {
  status: string
  ownerId: string
  reviewDueAt: string | null
}

function inTab(
  r: ProtocolTabInput,
  tab: ProtocolTab,
  currentUserId: string,
): boolean {
  if (tab === 'effective') return r.status === 'active'
  if (tab === 'mine') return r.ownerId === currentUserId
  if (tab === 'inreview') return r.status === 'under_review'
  if (tab === 'reviewdue')
    return (
      r.status === 'under_review' &&
      r.reviewDueAt !== null &&
      Date.parse(r.reviewDueAt) <= Date.now()
    )
  return r.status === 'archived'
}

function ProtocolsList() {
  const { context } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [sorting, setSorting] = useState<SortingState>(SORTS.Updated)
  const [selectedId, setSelectedId] = useState<string | null>(
    search.selected ?? null,
  )
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    selectedId,
    setSelectedId,
  )
  const openProtocol = useOpenRow<NotebookRecord>(
    navigate,
    (row) => `/protocols/${encodeURIComponent(row.id)}`,
    (row) => row.title,
  )
  const query = useQuery({
    queryKey: ['ui-port', 'protocols'],
    queryFn: () =>
      fetchTemplates(notebookDataClient, { kind: 'protocol_template' }),
    staleTime: 15_000,
  })
  const rows = query.data ?? []
  const names = useUserNames(rows.map((r) => r.createdByUserId).filter(Boolean))
  const currentUserId = context.user.id
  const tab: ProtocolTab = search.tab ?? 'effective'
  const tabInput = useMemo(
    () =>
      rows.map((r) => ({
        status: r.status,
        ownerId: r.createdByUserId,
        reviewDueAt: (r.properties.review_due_at as string | undefined) ?? null,
      })),
    [rows],
  )
  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((t) => [
          t,
          tabInput.filter((r) => inTab(r, t, currentUserId)).length,
        ]),
      ) as Record<ProtocolTab, number>,
    [tabInput, currentUserId],
  )
  const q = (search.q ?? '').trim().toLowerCase()
  // The table orders the rows; the tab and the search decide which ones.
  const visible = rows
    .map((r, i) => ({ r, input: tabInput[i] }))
    .filter(({ input }) => inTab(input, tab, currentUserId))
    .filter(
      ({ r }) => !q || `${r.identifier} ${r.title}`.toLowerCase().includes(q),
    )
    .map(({ r }) => r)

  // One row drives the inspector: the checkbox selects it, and with nothing
  // checked the screen falls back to the URL's row or the first one.
  const sel =
    visible.find((r) => r.id === selectedId) ??
    visible.find((r) => r.id === search.selected) ??
    visible.at(0)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Protocols"
          total={rows.length}
          actions={<NewProtocolDialog />}
          tabs={
            <Tabs
              mode="url"
              label="Protocol lists"
              value={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: counts[t],
                link: {
                  to: '/protocols',
                  search: {
                    tab: t === 'effective' ? undefined : t,
                    q: search.q,
                  },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search protocols"
          placeholder="Search protocols"
          views={{
            sorts: [...sorts],
            sort: sortKeyOf(sorting),
            onSort: (s) => setSorting(SORTS[s as ProtocolSort]),
            showSortValue: false,
            groupLabel: '',
          }}
          onSearch={(next) =>
            void navigate({
              to: '/protocols',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          {query.isLoading || visible.length > 0 ? (
            <ProtocolsRegistryGrid
              rows={visible}
              ownerLabel={names.userLabel}
              isLoading={query.isLoading}
              sorting={sorting}
              onSortingChange={setSorting}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onOpen={openProtocol}
            />
          ) : null}
          <MobileList
            label="Protocols"
            items={visible.map((p) => {
              const status = protocolStatus(p.status)
              return {
                key: p.id,
                id: p.identifier,
                title: p.title,
                sub: names.userLabel(p.createdByUserId),
                status: <Status tone={status.tone}>{status.label}</Status>,
                link: {
                  to: '/protocols/$protocolId',
                  params: { protocolId: p.id },
                },
              }
            })}
          />
          {!query.isLoading && visible.length === 0 ? (
            <div role="status" className="flex justify-center px-6">
              <EmptyState
                icon={q ? 'search' : 'protocol'}
                className="items-center py-14 text-center"
                title={
                  q
                    ? `No protocols match “${search.q}”`
                    : `No protocols in ${tabLabel[tab].toLowerCase()}`
                }
                description="Search looks at protocol identifiers and titles."
                action={
                  q ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link to="/protocols" search={{ tab: search.tab }} />
                      }
                    >
                      Clear search
                    </Button>
                  ) : (
                    <NewProtocolDialog />
                  )
                }
              />
            </div>
          ) : null}
        </div>
        <ListFooter right={selectedId ? '1 selected' : undefined}>
          {footerCount({
            shown: visible.length,
            total: counts[tab],
            one: 'protocol',
            tab: tabLabel[tab],
          })}
        </ListFooter>
      </div>

      {sel ? (
        <Inspector
          aria-label="Protocol summary"
          className="w-[320px] gap-0 p-0"
        >
          <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
            <span className="mono text-fg-muted">{sel.identifier}</span>
            <div className="font-heading text-doc font-semibold">
              {sel.title}
            </div>
            <div className="text-label">
              <Status tone={protocolStatus(sel.status).tone}>
                {protocolStatus(sel.status).label}
              </Status>
            </div>
          </div>
          <div className="flex flex-col gap-4 px-4 py-3.5">
            <InspectorSection title="Details">
              <DescriptionList
                labelWidth={90}
                items={[
                  ['Owner', names.userLabel(sel.createdByUserId)],
                  ['Structure', `v${sel.structureVersion}`],
                  ['Updated', sel.updatedAt.slice(0, 10)],
                ]}
              />
            </InspectorSection>
            <InspectorSection title="Versioning">
              <Muted>
                Open the protocol to see its versions, approvals and what
                changed between them.
              </Muted>
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}
    </div>
  )
}
