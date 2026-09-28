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

import { Status } from '#/components/v3/ui/status'
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
import {
  ListFooter,
  ListHeader,
  ListToolbar,
  MobileList,
  SearchTabs,
  stickyCell,
  stickyHead,
} from '#/components/v3/inventory/list'
import { notebookDataClient } from '#/lib/notebook-data'
import { fetchTemplates } from '#/lib/templates'
import { useUserNames } from '#/lib/user-names'
import type { Tone } from '#/components/v3/ui/status'

const tabs = ['all', 'active', 'review', 'drafts'] as const
type ProtocolTab = (typeof tabs)[number]
const tabLabel: Record<ProtocolTab, string> = {
  all: 'All',
  active: 'Active',
  review: 'In review',
  drafts: 'Drafts',
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
    tab:
      search.tab === 'active' ||
      search.tab === 'review' ||
      search.tab === 'drafts' ||
      search.tab === 'all'
        ? search.tab
        : undefined,
  }),
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
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

export function protocolStatus(status: string): { tone: Tone; label: string } {
  switch (status) {
    case 'active':
      return { tone: 'ok', label: 'Active' }
    case 'under_review':
      return { tone: 'review', label: 'In review' }
    case 'draft':
      return { tone: 'draft', label: 'Draft' }
    case 'archived':
      return { tone: 'stored', label: 'Archived' }
    default:
      return {
        tone: 'none',
        label:
          status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '),
      }
  }
}

function inTab(status: string, tab: ProtocolTab): boolean {
  if (tab === 'all') return true
  if (tab === 'active') return status === 'active'
  if (tab === 'review') return status === 'under_review'
  return status === 'draft'
}

function ProtocolsList() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['ui-port', 'protocols'],
    queryFn: () =>
      fetchTemplates(notebookDataClient, { kind: 'protocol_template' }),
    staleTime: 15_000,
  })
  const rows = query.data ?? []
  const names = useUserNames(rows.map((r) => r.createdByUserId).filter(Boolean))
  const tab: ProtocolTab = search.tab ?? 'all'
  const counts = useMemo(
    () =>
      Object.fromEntries(
        tabs.map((t) => [t, rows.filter((r) => inTab(r.status, t)).length]),
      ) as Record<ProtocolTab, number>,
    [rows],
  )
  const q = (search.q ?? '').trim().toLowerCase()
  const visible = rows
    .filter((r) => inTab(r.status, tab))
    .filter((r) => !q || `${r.identifier} ${r.title}`.toLowerCase().includes(q))
  const sel =
    visible.find((r) => r.id === (selected ?? search.selected)) ?? visible.at(0)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Protocols"
          total={rows.length}
          tabs={
            <SearchTabs
              label="Protocol lists"
              current={tab}
              items={tabs.map((t) => ({
                key: t,
                label: tabLabel[t],
                count: counts[t],
                link: {
                  to: '/protocols',
                  search: { tab: t === 'all' ? undefined : t, q: search.q },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label="Search protocols"
          placeholder="Search protocols"
          onSearch={(next) =>
            void navigate({
              to: '/protocols',
              search: (s) => ({ ...s, q: next || undefined }),
              replace: true,
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <Table aria-label="Protocols" className="max-lg:hidden">
            <TableHeader>
              <TableRow>
                <TableHead className={stickyHead}>ID</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead align="right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => {
                const status = protocolStatus(p.status)
                return (
                  <TableRow
                    key={p.id}
                    selected={p.id === sel?.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(p.id)}
                  >
                    <TableCell className={stickyCell}>
                      <span className="mono">{p.identifier}</span>
                    </TableCell>
                    <TableCell
                      className={p.id === sel?.id ? 'font-medium' : undefined}
                    >
                      <Link
                        to="/protocols/$protocolId"
                        params={{ protocolId: p.id }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Status tone={status.tone}>{status.label}</Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {names.userLabel(p.createdByUserId)}
                    </TableCell>
                    <TableCell align="right" className="text-fg-muted">
                      {p.updatedAt.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
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
                body="Search looks at protocol identifiers and titles."
              />
            </div>
          ) : null}
        </div>
        <ListFooter right={sel ? '1 selected' : undefined}>
          {visible.length} of {counts[tab]} {tabLabel[tab].toLowerCase()}
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
                Controlled protocol versions with approval chains are a later
                capability; a protocol record currently stores no version.
              </Muted>
            </InspectorSection>
          </div>
        </Inspector>
      ) : null}
    </div>
  )
}
