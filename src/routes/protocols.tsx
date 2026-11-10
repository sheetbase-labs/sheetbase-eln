import { useCallback, useMemo, useState } from 'react'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { z } from 'zod'

import { useListView } from '#/lib/list-views'

import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Status } from '#/components/ui/status'
import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
} from '#/components/ui/layout'
import {
  ListFooter,
  ListHeader,
  ReadOnlyNote,
  ListToolbar,
  MobileList,
  footerCount,
} from '#/components/inventory/list'
import {
  ProtocolsRegistryGrid,
  protocolStatus,
} from '#/components/protocols/protocols-registry-grid'
import { useRowFocus } from '#/components/inventory/registry-grid'
import { useBulkSelection } from '#/components/inventory/bulk-selection'
import { RecordBulkBar } from '#/components/inventory/record-bulk-bar'
import { Tabs } from '#/components/ui/tabs'
import { NewProtocolDialog } from '#/components/protocols/new-protocol-dialog'
import { useAddedFieldListColumns } from '#/components/models/added-fields'
import { notebookDataClient } from '#/lib/notebook-data'
import type { NotebookRecord } from '#/lib/notebook-data'
import { useOpenRow } from '#/components/workspace/workspace-navigation'
import { fetchTemplates } from '#/lib/templates'
import { useUserNames } from '#/lib/user-names'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { now as appNow } from '#/lib/clock'
import { formatDate } from '#/lib/format-date'
import { t } from '#/copy'
import { hasCapability } from '#/lib/capability'

const tabs = ['effective', 'mine', 'inreview', 'reviewdue', 'archived'] as const

type ProtocolTab = (typeof tabs)[number]

/** The orderings the list offers. These template records carry no effective
 * date — the reference's Effective column has no model behind it, and
 * controlled versions with one are a later capability — so the menu offers the
 * keys the route can actually apply. */
const sorts: string[] = [
  t('library.protocols.list.updated'),
  'ID',
  t('library.protocols.list.protocol'),
]

type ProtocolSort = string

/** A search value from the URL, present only when the URL carried text. */
const protocolSearchText = z.string()

/** The protocol list's search, as the URL carries it. */
interface ProtocolsSearch {
  q?: string
  tab?: ProtocolTab
  selected?: string
  new?: true
}

/** A count per protocol list, as the tab strip and the footer read them. */
const protocolTabCounts = z.record(z.enum(tabs), z.number())

/** A tab name from the URL, present only when the screen offers that list. */
const protocolTabParam = z
  .string()
  .transform((value) => tabs.find((tab) => tab === value))

const tabLabel: Record<ProtocolTab, string> = {
  effective: t('library.protocols.list.effective'),
  mine: t('library.protocols.list.mine'),
  inreview: t('library.protocols.list.inReview'),
  reviewdue: t('library.protocols.list.reviewDue'),
  archived: t('library.protocols.list.archived'),
}

/** The orderings the toolbar offers, as the grid's sorting state. The route
 * owns the menu; the table owns the order, so a header click and a menu pick
 * are the same single source. */
const SORTS = new Map<ProtocolSort, SortingState>([
  [t('library.protocols.list.updated'), [{ id: 'updatedAt', desc: true }]],
  ['ID', [{ id: 'identifier', desc: false }]],
  [t('library.protocols.list.protocol'), [{ id: 'title', desc: false }]],
])

/** The menu key a sorting state came from, or undefined when the user sorted
 * by a column the menu does not list. */
function sortKeyOf(sorting: SortingState): ProtocolSort | undefined {
  const first = sorting.at(0)

  if (!first) return undefined

  return [...SORTS.keys()].find((key) => {
    const entry = SORTS.get(key)?.at(0)

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
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- TanStack Router hands validateSearch the raw URL values as Record<string, unknown>; every value is decoded below before use.
    search: Record<string, unknown>,
  ): ProtocolsSearch => ({
    new: search.new === true || search.new === 'true' ? true : undefined,
    q: protocolSearchText.safeParse(search.q).data,
    selected: protocolSearchText.safeParse(search.selected).data,
    tab: protocolTabParam.safeParse(search.tab).data,
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
      Date.parse(r.reviewDueAt) <= appNow().getTime()
    )

  return r.status === 'archived'
}

/** The tab inputs, one per row, in row order. */
function tabInputsOf(rows: readonly NotebookRecord[]): ProtocolTabInput[] {
  return rows.map((r) => ({
    status: r.status,
    ownerId: r.createdByUserId,
    reviewDueAt:
      protocolSearchText.safeParse(r.properties.review_due_at).data ?? null,
  }))
}

/** How many protocols each list holds for this person. */
function tabCountsOf(
  inputs: readonly ProtocolTabInput[],
  currentUserId: string,
): Record<ProtocolTab, number> {
  return protocolTabCounts.parse(
    Object.fromEntries(
      tabs.map((item) => [
        item,
        inputs.filter((r) => inTab(r, item, currentUserId)).length,
      ]),
    ),
  )
}

/** The rows the tab and the search leave, in the order the table gave them. */
function visibleProtocols(
  rows: readonly NotebookRecord[],
  inputs: readonly ProtocolTabInput[],
  tab: ProtocolTab,
  currentUserId: string,
  query: string,
): NotebookRecord[] {
  const matched: NotebookRecord[] = []

  for (const [index, row] of rows.entries()) {
    const input = inputs[index]

    if (!inTab(input, tab, currentUserId)) continue

    const haystack = `${row.identifier} ${row.title}`.toLowerCase()

    if (query && !haystack.includes(query)) continue

    matched.push(row)
  }

  return matched
}

function ProtocolsList() {
  const { context } = Route.useRouteContext()
  const canWrite = hasCapability(context.workspace?.role, 'record.create')
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const dropNewFlag = useCallback(() => {
    void navigate({
      search: (current) => ({ ...current, new: undefined }),
      replace: true,
    })
  }, [navigate])

  // The person's own sorting (a header click, or the Sort menu) is remembered;
  // with none, the newest-updated protocols lead.
  const view = useListView('protocols')

  const sorting = view.sorting.length
    ? view.sorting
    : (SORTS.get(t('library.protocols.list.updated')) ?? [])

  const setSorting = view.setSorting
  const queryClient = useQueryClient()
  const bulk = useBulkSelection()

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

  const rows = useMemo(() => query.data ?? [], [query.data])
  const names = useUserNames(rows.map((r) => r.createdByUserId).filter(Boolean))

  const addedColumns = useAddedFieldListColumns<NotebookRecord>(
    'protocol_template',
    'id',
  )

  const currentUserId = context.user.id
  const tab: ProtocolTab = search.tab ?? 'effective'

  const tabInput = useMemo(() => tabInputsOf(rows), [rows])

  const counts = useMemo(
    () => tabCountsOf(tabInput, currentUserId),
    [tabInput, currentUserId],
  )

  const q = (search.q ?? '').trim().toLowerCase()

  // The table orders the rows; the tab and the search decide which ones.
  const visible = visibleProtocols(rows, tabInput, tab, currentUserId, q)

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
          title={t('library.protocols.list.protocols')}
          total={query.isPending ? undefined : rows.length}
          actions={
            canWrite ? (
              <NewProtocolDialog
                autoOpen={search.new === true}
                onAutoOpened={dropNewFlag}
              />
            ) : (
              <ReadOnlyNote>
                {t('common.readOnly.cannotAdd', {
                  things: t('common.readOnly.things.protocols'),
                })}
              </ReadOnlyNote>
            )
          }
          tabs={
            <Tabs
              mode="url"
              label={t('library.protocols.list.protocolLists')}
              value={tab}
              items={tabs.map((item) => ({
                key: item,
                label: tabLabel[item],
                count: query.isPending ? undefined : counts[item],
                link: {
                  to: '/protocols',
                  search: {
                    tab: item === 'effective' ? undefined : item,
                    q: search.q ?? '',
                  },
                },
              }))}
            />
          }
        />
        <ListToolbar
          q={search.q}
          label={t('library.protocols.list.searchProtocols')}
          placeholder={t('library.protocols.list.searchProtocols')}
          views={{
            sorts,
            sort: sortKeyOf(sorting),
            onSort: (s) => setSorting(SORTS.get(s) ?? []),
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
        <RecordBulkBar
          selection={bulk}
          kind="protocol_template"
          archive={false}
          canWrite={canWrite}
          onChanged={() =>
            void queryClient.invalidateQueries({
              queryKey: ['ui-port', 'protocols'],
            })
          }
        />
        <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
          {query.isPending || visible.length > 0 ? (
            <ProtocolsRegistryGrid
              bulk={bulk}
              addedColumns={addedColumns}
              rows={visible}
              ownerLabel={names.userLabel}
              isLoading={query.isPending}
              view={view}
              sorting={sorting}
              onSortingChange={setSorting}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onOpen={openProtocol}
            />
          ) : null}
          <MobileList
            label={t('library.protocols.list.protocols')}
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
          <ProtocolsEmpty
            isLoading={query.isPending}
            hasRows={visible.length > 0}
            query={q}
            tab={tab}
            searchQuery={search.q}
            searchTab={search.tab}
          />
        </div>
        <ListFooter
          loading={query.isPending}
          right={selectedId ? '1 selected' : undefined}
        >
          {footerCount({
            shown: visible.length,
            total: counts[tab],
            one: 'protocol',
            tab: tabLabel[tab],
          })}
        </ListFooter>
      </div>

      <ProtocolSummary protocol={sel} userLabel={names.userLabel} />
    </div>
  )
}

/** The registry's empty state: why the list is empty, and what to do next. */
function ProtocolsEmpty({
  isLoading,
  hasRows,
  query,
  tab,
  searchQuery,
  searchTab,
}: {
  isLoading: boolean
  hasRows: boolean
  query: string
  tab: ProtocolTab
  searchQuery: string | undefined
  searchTab: ProtocolTab | undefined
}) {
  if (isLoading || hasRows) return null

  const isSearch = query.length > 0

  return (
    <div role="status" className="flex justify-center px-6">
      <EmptyState
        icon={isSearch ? 'search' : 'protocol'}
        className="items-center py-14 text-center"
        title={
          isSearch
            ? t('library.protocols.list.noProtocolsMatch', {
                q: searchQuery ?? '',
              })
            : t('library.protocols.list.noProtocolsIn', { tab: tabLabel[tab] })
        }
        description={t(
          'library.protocols.list.searchLooksAtProtocolIdentifiers',
        )}
        action={
          isSearch ? (
            <Button
              nativeButton={false}
              render={<Link to="/protocols" search={{ tab: searchTab }} />}
            >
              {t('library.protocols.list.clearSearch')}
            </Button>
          ) : (
            <NewProtocolDialog />
          )
        }
      />
    </div>
  )
}

/** The selected protocol's summary, or nothing when no row is selected. */
function ProtocolSummary({
  protocol,
  userLabel,
}: {
  protocol: NotebookRecord | undefined
  userLabel: (userId: string) => string
}) {
  if (!protocol) return null

  return (
    <Inspector
      aria-label={t('library.protocols.list.protocolSummary')}
      className="w-[320px] gap-0 p-0"
    >
      <div className="flex flex-col gap-1 border-b border-border px-4 pb-3 pt-3.5">
        <span className="mono text-fg-muted">{protocol.identifier}</span>
        <div className="font-heading text-doc font-semibold">
          {protocol.title}
        </div>
        <div className="text-label">
          <Status tone={protocolStatus(protocol.status).tone}>
            {protocolStatus(protocol.status).label}
          </Status>
        </div>
      </div>
      <div className="flex flex-col gap-4 px-4 py-3.5">
        <InspectorSection title={t('library.protocols.list.details')}>
          <DescriptionList
            labelWidth={90}
            items={[
              [
                t('library.protocols.list.owner'),
                userLabel(protocol.createdByUserId),
              ],
              [
                t('library.protocols.list.structure'),
                `v${protocol.structureVersion}`,
              ],
              [
                t('library.protocols.list.updated'),
                formatDate(protocol.updatedAt),
              ],
            ]}
          />
        </InspectorSection>
        <InspectorSection title={t('library.protocols.list.versioning')}>
          <Muted>{t('library.protocols.list.openTheProtocolToSee')}</Muted>
        </InspectorSection>
      </div>
    </Inspector>
  )
}
