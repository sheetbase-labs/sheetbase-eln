import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
  useSearch,
} from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'

import { Button } from '#/components/v3/ui/button'
import { Dot, Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Inspector,
  InspectorSection,
  DescriptionList,
} from '#/components/v3/ui/layout'
import { Kbd } from '#/components/v3/ui/kbd'
import { Tabs } from '#/components/v3/ui/tabs'
import { ListHeader } from '#/components/v3/inventory/list'
import {
  useRegisterShortcuts,
  useShortcutScope,
} from '#/components/shortcuts/shortcut-provider'
import { resolveRunForWorkItem } from '#/components/v3/pipelines/pipelines-data'
import { listShortcuts } from '#/lib/shortcut-scopes'
import { cn } from '#/lib/utils'
import {
  fetchSeenItemKeys,
  groupWorkItems,
  useWorkItems,
  workItemsQueryKeys,
} from '#/lib/work-items/data'
import type { WorkItem, WorkItemKind } from '#/lib/work-items/data'
import { itemLink } from '#/lib/work-items/destination'
import { itemKey, itemTab, workItemType } from '#/lib/work-items/predicate'
import type { InboxTab, WorkItemType } from '#/lib/work-items/predicate'

type InboxType = WorkItemType

const tabs: [InboxTab, string][] = [
  ['needs-action', 'Needs action'],
  ['following', 'Following'],
  ['done-today', 'Done today'],
]
const types: [InboxType, string, Tone, WorkItemKind][] = [
  ['reviews', 'Reviews', 'review', 'review_requested'],
  ['data', 'Data issues', 'bad', 'data_issue'],
  ['runs', 'Runs', 'analysis', 'run_failed'],
  ['materials', 'Materials', 'warn', 'material_expiring'],
  ['lab', 'Lab', 'warn', 'sample_awaiting_release'],
  ['admin', 'Access & admin', 'stored', 'access_requested'],
]

/** UI port (roadmap-4/ui-app3): the Inbox, wired to `my_work_items`. */
export const Route = createFileRoute('/inbox')({
  // The Home chips open a specific tab/type here, so the set a chip counted is
  // the set the page shows.
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: InboxTab; type?: InboxType; item?: string } => ({
    // The selected item lives in the URL, so a reload, Back and a shared link
    // land on the same row.
    item:
      typeof search.item === 'string' && search.item ? search.item : undefined,
    tab:
      search.tab === 'following' ||
      search.tab === 'done-today' ||
      search.tab === 'needs-action'
        ? search.tab
        : undefined,
    type:
      search.type === 'reviews' ||
      search.type === 'data' ||
      search.type === 'runs' ||
      search.type === 'materials' ||
      search.type === 'lab' ||
      search.type === 'admin' ||
      search.type === 'following'
        ? search.type
        : undefined,
  }),
  component: Inbox,
})

function toneFor(kind: WorkItemKind): Tone {
  if (kind === 'review_requested' || kind === 'witness_requested')
    return 'review'
  if (kind === 'data_issue') return 'bad'
  if (kind === 'run_failed') return 'bad'
  // A run waiting for a person is actionable, not broken.
  if (kind === 'run_waiting') return 'warn'
  if (kind === 'material_expiring') return 'warn'
  // A returned review, an unsigned approval and an overdue calibration are
  // waiting on the person, not broken.
  if (
    kind === 'review_returned' ||
    kind === 'approval_unsigned' ||
    kind === 'sample_awaiting_release' ||
    kind === 'sample_hold_exceeded' ||
    kind === 'calibration_overdue'
  )
    return 'warn'
  if (kind === 'witness_signed') return 'review'
  // A conflict is actionable: two edits need a person to choose between them.
  if (kind === 'cell_conflict') return 'warn'
  return 'stored'
}

function labelFor(kind: WorkItemKind, state: string): string {
  if (kind === 'calibration_overdue') return 'Calibration'
  if (kind === 'witness_requested') return 'Witness requested'
  if (state === 'overdue') return 'Overdue'
  if (kind === 'review_requested') return 'Review'
  if (kind === 'data_issue') return 'Data issue'
  if (kind === 'run_failed') return 'Failed'
  if (kind === 'run_waiting') return 'Waiting'
  if (kind === 'material_expiring') return 'Material'
  if (kind === 'cell_conflict') return 'Conflict'
  if (kind === 'review_returned') return 'Returned'
  if (kind === 'approval_unsigned') return 'Sign'
  if (kind === 'witness_signed') return 'Witnessed'
  if (kind === 'access_requested') return 'Access request'
  if (kind === 'access_decided') return 'Access decided'
  if (kind === 'agent_proposal') return 'Agent proposal'
  if (kind === 'invitation_accepted') return 'Joined'
  if (kind === 'verification_requested') return 'Verify identity'
  if (kind === 'verification_granted') return 'Verified'
  if (kind === 'sample_awaiting_release') return 'Quarantined'
  if (kind === 'sample_hold_exceeded') return 'Hold exceeded'
  return 'Following'
}

/** The per-row identity used for selection and the rendered list key. */
export function rowKey(item: WorkItem): string {
  return item.sourceId ?? item.recordId ?? item.identifier ?? item.title
}

/**
 * Move an Inbox selection by `delta`, clamping at both ends. A null or unknown
 * current selection is treated as the first row, so the first `J` advances off
 * the row that is already implicitly highlighted.
 */
export function moveListSelection(
  keys: readonly string[],
  current: string | null,
  delta: number,
): string | null {
  if (keys.length === 0) return null
  const index = current ? keys.indexOf(current) : -1
  const base = index === -1 ? 0 : index
  const next = Math.min(keys.length - 1, Math.max(0, base + delta))
  return keys[next]
}

export { itemLink }

/** The specific run a failed or waiting item is about, once it is resolved. */
export function runLink(runId: string) {
  return { to: '/pipelines/runs/$runId' as const, params: { runId } }
}

/** The run a failed or waiting item is about; null for any other kind. */
function useItemRun(item: WorkItem | undefined) {
  const isRun = item?.kind === 'run_failed' || item?.kind === 'run_waiting'
  return useQuery({
    queryKey: [
      'inbox',
      'item-run',
      item?.kind,
      item?.sourceId,
      item?.identifier,
    ],
    queryFn: () => (item ? resolveRunForWorkItem(item) : null),
    enabled: isRun,
    staleTime: 30_000,
  })
}

/** The record page for an item, when it names one. */
export function recordLink(item: WorkItem) {
  return item.recordId
    ? { to: '/records/$recordId' as const, params: { recordId: item.recordId } }
    : { to: '/inbox' as const }
}

/**
 * MOB-01.2 — reviewing and signing need more room than a phone has. The item
 * still opens the full record there, with the reason stated rather than a
 * silently narrower screen.
 */
export function reviewNeedsLargerScreen(item: WorkItem): boolean {
  return item.kind === 'review_requested' || item.kind === 'witness_requested'
}

function Inbox() {
  const query = useWorkItems()
  const items = query.data ?? []
  const search = useSearch({ from: '/inbox' })
  const [tab, setTab] = useState<InboxTab>(search.tab ?? 'needs-action')
  const [type, setType] = useState<InboxType | undefined>(search.type)
  // QA3-lists-inbox-2 — `later` is the person's explicit choice: null means
  // "follow the default", which expands the bucket when it holds every row the
  // tab would render. A tab whose items are all undated then shows its rows
  // instead of its count over an empty list, and the group's Collapse control
  // still wins once the person has chosen.
  const [later, setLater] = useState<boolean | null>(null)
  const [selectedKey, setSelectedKeyState] = useState<string | null>(
    search.item ?? null,
  )
  const [selection, setSelection] = useState<Set<string>>(() => new Set())

  // A chip on Home links to /inbox?type=… — follow the URL when it changes on
  // an already-mounted page, not only on first mount.
  useEffect(() => {
    if (search.tab) setTab(search.tab)
    setType(search.type)
  }, [search.tab, search.type])
  // Back and Forward move the selection with the address.
  useEffect(() => {
    setSelectedKeyState(search.item ?? null)
  }, [search.item])

  const queryClient = useQueryClient()
  const router = useRouter()
  const seenQuery = useQuery({
    queryKey: workItemsQueryKeys.seen(),
    queryFn: () => fetchSeenItemKeys(),
    staleTime: 15_000,
  })
  const seen = seenQuery.data ?? new Set<string>()

  const groups = useMemo(() => groupWorkItems(items), [items])
  const inTab = items.filter((i) => itemTab(i, seen) === tab)
  const visible = inTab.filter((i) => !type || workItemType(i.kind) === type)
  const visibleKeys = useMemo(
    () => new Set(visible.map((i) => itemKey(i))),
    [visible],
  )
  // The Later bucket is the tab's only group when every visible row lives in
  // it (in this workspace every needs-action item is undated, so that is the
  // whole tab).
  const laterHoldsEveryRow =
    visible.length > 0 && visible.every((i) => groups.later.includes(i))
  const laterExpanded = later ?? laterHoldsEveryRow
  const shown = visible.filter(
    (i) => laterExpanded || !groups.later.includes(i),
  )
  const hiddenLater = groups.later.filter(
    (i) => itemTab(i, seen) === tab && (!type || workItemType(i.kind) === type),
  ).length
  const sections: [string | null, WorkItem[]][] = useMemo(
    () =>
      tab === 'needs-action'
        ? [
            ['Today', groups.today.filter((i) => visibleKeys.has(itemKey(i)))],
            [
              'Next 7 days',
              groups.nextSevenDays.filter((i) => visibleKeys.has(itemKey(i))),
            ],
            [
              'Later',
              laterExpanded
                ? groups.later.filter((i) => visibleKeys.has(itemKey(i)))
                : [],
            ],
          ]
        : [[null, shown]],
    [tab, groups, laterExpanded, shown, visibleKeys],
  )
  const orderedRows = useMemo(
    () => sections.flatMap(([, group]) => group),
    [sections],
  )
  const selected =
    orderedRows.find((i) => rowKey(i) === selectedKey) ?? orderedRows[0]
  const selectedRun = useItemRun(selected)
  const selectedCount = orderedRows.filter((item) =>
    selection.has(rowKey(item)),
  ).length

  // Bulk select: the checked rows that still need action are what "Mark
  // selected seen" acts on.
  const selectedSeenKeys = useMemo(
    () =>
      orderedRows
        .filter(
          (item) =>
            selection.has(rowKey(item)) &&
            itemTab(item, seen) === 'needs-action',
        )
        .map(itemKey),
    [orderedRows, selection, seen],
  )

  const tabCount = (t: InboxTab) =>
    items.filter((i) => itemTab(i, seen) === t).length
  const typeCount = (t: InboxType) =>
    inTab.filter((i) => workItemType(i.kind) === t).length
  const typeLabel = type
    ? (types.find(([t]) => t === type)?.[1] ?? type)
    : undefined

  // QA2-Inbox-2: while the read is outstanding the counts are unknown, not
  // zero. Stating 0 made the page disagree with the sidebar and hid the fact
  // that nothing had answered yet.
  const countsKnown = !query.isLoading

  // QA3-inbox-1 — "Mark all seen" acts on the items the current tab and type
  // chip show, not on every needs-action item. On Following and Done today
  // there is nothing of the sort on screen, and a type chip narrows the list,
  // so marking the rest reported success for work the person could not see.
  const markableKeys = useMemo(
    () =>
      visible.filter((i) => itemTab(i, seen) === 'needs-action').map(itemKey),
    [visible, seen],
  )

  // SHELL-03.3 — the List scope through the single shortcut registry. The
  // ordered rows and the current selection live in refs so the registered
  // handlers stay stable and the provider does not re-register every render.
  const navigate = useNavigate()

  // QA3-inbox-4 — the tab and the type chips write the URL, so a reload and
  // Back agree with the list on screen. The URL was only ever read: clicking
  // Following left `?type=reviews` in the address bar and a reload restored
  // the old filter.
  const updateSearch = useCallback(
    (patch: { tab?: InboxTab; type?: InboxType; item?: string }) => {
      void navigate({
        to: '/inbox',
        search: (previous: {
          tab?: InboxTab
          type?: InboxType
          item?: string
        }) => ({
          ...previous,
          ...patch,
        }),
      } as never)
    },
    [navigate],
  )
  // Choosing a row writes it to the URL; a replace keeps J/K from filling the
  // history with one entry per row.
  const selectedKeyRef = useRef<string | null>(selectedKey)
  const setSelectedKey = useCallback(
    (key: string | null) => {
      if (key === selectedKeyRef.current) return
      selectedKeyRef.current = key
      setSelectedKeyState(key)
      void navigate({
        to: '/inbox',
        search: (previous: {
          tab?: InboxTab
          type?: InboxType
          item?: string
        }) => ({ ...previous, item: key ?? undefined }),
        replace: true,
      } as never)
    },
    [navigate],
  )
  const selectTab = (next: InboxTab) => {
    setTab(next)
    setType(undefined)
    setLater(null)
    updateSearch({
      tab: next === 'needs-action' ? undefined : next,
      type: undefined,
      item: undefined,
    })
  }
  const selectType = (next: InboxType | undefined) => {
    setType(next)
    updateSearch({ type: next })
  }

  const filterRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<WorkItem[]>(orderedRows)
  useEffect(() => {
    rowsRef.current = orderedRows
    selectedKeyRef.current = selectedKey
  }, [orderedRows, selectedKey])
  const move = useCallback(
    (delta: number) => {
      setSelectedKey(
        moveListSelection(
          rowsRef.current.map(rowKey),
          selectedKeyRef.current,
          delta,
        ),
      )
    },
    [setSelectedKey],
  )
  const openSelected = useCallback(() => {
    const item =
      rowsRef.current.find((i) => rowKey(i) === selectedKeyRef.current) ??
      rowsRef.current.at(0)
    if (!item) return
    if (item.kind === 'run_failed' || item.kind === 'run_waiting') {
      void resolveRunForWorkItem(item)
        .catch(() => null)
        .then((runId) =>
          navigate((runId ? runLink(runId) : itemLink(item)) as never),
        )
      return
    }
    void navigate(itemLink(item) as never)
  }, [navigate])
  const selectCurrent = useCallback((add: boolean) => {
    const item =
      rowsRef.current.find((i) => rowKey(i) === selectedKeyRef.current) ??
      rowsRef.current.at(0)
    if (!item) return
    setSelection((current) => new Set([...(add ? current : []), rowKey(item)]))
  }, [])
  useShortcutScope('list')
  useRegisterShortcuts(
    useMemo(
      () =>
        listShortcuts({
          moveUp: () => move(-1),
          moveDown: () => move(1),
          next: () => move(1),
          previous: () => move(-1),
          open: openSelected,
          select: () => selectCurrent(false),
          addToSelection: () => selectCurrent(true),
          filter: () =>
            filterRef.current
              ?.querySelector<HTMLButtonElement>('button')
              ?.focus(),
        }),
      [move, openSelected, selectCurrent],
    ),
  )

  const markSeen = useMutation({
    mutationFn: (keys: string[]) =>
      notebookDataClient.rpc('mark_work_items_seen', { p_item_keys: keys }),
    onSuccess: () => {
      toast('Marked as seen')
      void queryClient.invalidateQueries({ queryKey: ['work-items'] })
      // The Inbox badge and Home counts come from the router context, which
      // only a route re-resolution refreshes.
      void router.invalidate()
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : 'Couldn’t mark them.',
      ),
  })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title="Inbox"
          subtitle="Everything waiting on you, across projects"
          actions={
            <>
              <Button
                nativeButton={false}
                render={<Link to="/settings/notifications" />}
              >
                Notification settings
              </Button>
              <Button
                disabled={markSeen.isPending || markableKeys.length === 0}
                onClick={() => markSeen.mutate(markableKeys)}
              >
                Mark all seen
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="state"
              label="Inbox"
              value={tab}
              onValueChange={(next) => selectTab(next as InboxTab)}
              className="mt-1"
              items={tabs.map(([key, label]) => ({
                key,
                label,
                count: countsKnown ? tabCount(key) : '—',
              }))}
            />
          }
        />

        <div
          ref={filterRef}
          role="toolbar"
          aria-label="Filter by type"
          className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 md:px-6 [&>button]:shrink-0"
        >
          <Button
            size="sm"
            variant="quiet"
            aria-pressed={!type}
            className={!type ? 'bg-selection hover:bg-selection' : undefined}
            onClick={() => selectType(undefined)}
          >
            All types
          </Button>
          {types.map(([t, l, tone]) => (
            <Button
              key={t}
              size="sm"
              variant="quiet"
              aria-pressed={type === t}
              className={
                type === t ? 'bg-selection hover:bg-selection' : undefined
              }
              onClick={() => selectType(type === t ? undefined : t)}
            >
              <Dot tone={tone} />
              {l} {countsKnown ? typeCount(t) : '—'}
            </Button>
          ))}
          <span className="flex-1" />
          {selectedCount > 0 ? (
            <>
              <span role="status" className="text-label text-fg-muted">
                {selectedCount} selected
              </span>
              <Button
                size="sm"
                variant="quiet"
                disabled={markSeen.isPending || selectedSeenKeys.length === 0}
                onClick={() =>
                  markSeen.mutate(selectedSeenKeys, {
                    onSuccess: () => setSelection(new Set()),
                  })
                }
              >
                Mark selected seen
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setSelection(new Set())}
              >
                Clear selection
              </Button>
            </>
          ) : null}
          <span className="shrink-0 whitespace-nowrap text-label text-fg-muted max-lg:hidden">
            Sorted by due date · <Kbd>J</Kbd>/<Kbd>K</Kbd> to move
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {query.isError ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
            >
              <div className="text-prose font-semibold">
                Couldn’t load your inbox
              </div>
              <div className="max-w-[460px] leading-[19px] text-fg-muted">
                {query.error instanceof Error
                  ? query.error.message
                  : 'The work list could not be read. Try again.'}
              </div>
              <Button
                size="sm"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {query.isFetching ? 'Trying…' : 'Try again'}
              </Button>
            </div>
          ) : orderedRows.length === 0 && hiddenLater === 0 ? (
            <div
              role="status"
              className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
            >
              <div className="text-prose font-semibold">
                {query.isLoading ? 'Loading…' : 'Nothing here'}
              </div>
              <div className="max-w-[460px] leading-[19px] text-fg-muted">
                {type
                  ? `No ${typeLabel} items in this tab.`
                  : tab === 'following'
                    ? 'Records you follow appear here.'
                    : tab === 'done-today'
                      ? 'Nothing has been marked seen or done today.'
                      : 'Nothing needs your action right now.'}
              </div>
              {/* QA3-inbox-2 — the type chips narrow the list, so the state
                  that empties it offers the way back. */}
              {type ? (
                <Button size="sm" onClick={() => selectType(undefined)}>
                  Clear filter
                </Button>
              ) : null}
            </div>
          ) : (
            <div role="list" aria-label="Inbox items">
              {sections.map(([g, rows]) => {
                if (!rows.length) return null
                return (
                  <div key={g ?? 'all'}>
                    <div
                      role="presentation"
                      className="flex h-8 items-center gap-2 border-b border-border-subtle bg-surface-muted px-4 text-label font-medium text-fg-muted md:px-6"
                    >
                      {g ?? tabs.find(([t]) => t === tab)![1]}
                      {/* QA3-lists-inbox-2 — the tab's own group states the
                          tab's total, so the strip and the list agree in one
                          viewport; a due-date group states its own rows. */}
                      <span className="num font-normal">
                        {g === null ? visible.length : rows.length}
                      </span>
                      {g === 'Later' ? (
                        <button
                          type="button"
                          aria-expanded
                          onClick={() => setLater(false)}
                          className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-label text-link"
                        >
                          Collapse
                        </button>
                      ) : null}
                    </div>
                    {rows.map((i, index) => {
                      const key = rowKey(i)
                      return (
                        <div
                          // QA3-lists-inbox-1 — `rowKey` mirrors the boundary
                          // identity, but distinct work items can share it
                          // (many data issues carry one dataset's identifier),
                          // and duplicate keys leave removed rows on screen.
                          // The position disambiguates the rendered siblings;
                          // `key` still drives selection.
                          key={`${key}#${index}`}
                          role="listitem"
                          aria-current={selected === i ? true : undefined}
                        >
                          <button
                            type="button"
                            aria-pressed={selection.has(key)}
                            onFocus={() => setSelectedKey(key)}
                            onClick={(event) => {
                              setSelectedKey(key)
                              setSelection(
                                (current) =>
                                  new Set([
                                    ...(event.ctrlKey || event.metaKey
                                      ? current
                                      : []),
                                    key,
                                  ]),
                              )
                            }}
                            className={cn(
                              'grid min-h-11 w-full cursor-pointer grid-cols-[104px_minmax(0,1fr)_110px] items-center gap-3 border-0 border-b border-border-subtle bg-transparent px-4 py-1.5 text-left hover:bg-row-hover md:px-6',
                              selected === i &&
                                'bg-selection hover:bg-selection',
                              selection.has(key) &&
                                'bg-selection hover:bg-selection',
                            )}
                          >
                            <Status
                              tone={toneFor(i.kind)}
                              className="min-w-0 whitespace-normal"
                            >
                              {labelFor(i.kind, i.state)}
                            </Status>
                            <span className="min-w-0">
                              <span className="block truncate text-body font-medium text-fg">
                                {i.identifier ? (
                                  <span className="mono mr-1.5 font-normal text-fg-muted">
                                    {i.identifier}
                                  </span>
                                ) : null}
                                {i.title}
                                {selection.has(key) ? (
                                  <span className="ml-2 text-label text-link">
                                    Selected
                                  </span>
                                ) : null}
                              </span>
                              <span className="block truncate text-label text-fg-muted">
                                {i.reason}
                              </span>
                            </span>
                            <span className="text-right text-label text-fg-muted">
                              {i.dueAt ? i.dueAt.slice(0, 10) : '—'}
                            </span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
          {hiddenLater > 0 && !laterExpanded ? (
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setLater(true)}
              className="flex h-9 w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-4 text-label text-fg-muted hover:text-fg md:px-6"
            >
              Later · {hiddenLater} items
            </button>
          ) : null}
        </div>
      </div>

      {shown.length ? (
        <Inspector aria-label="Item details" className="w-[320px]">
          <InspectorSection title="Item">
            <DescriptionList
              labelWidth={96}
              items={[
                ['Kind', labelFor(selected.kind, selected.state)],
                [
                  'Record',
                  <span className="mono">{selected.identifier ?? '—'}</span>,
                ],
                ['Reason', selected.reason],
                ['Due', selected.dueAt ? selected.dueAt.slice(0, 10) : '—'],
              ]}
            />
          </InspectorSection>
          <InspectorSection title="Actions">
            {reviewNeedsLargerScreen(selected) ? (
              <>
                {/* MOB-01.2: on a phone a review or signing item opens the full
                    record, and says why it is not the review surface. */}
                <Link
                  {...recordLink(selected)}
                  className="text-label md:hidden"
                >
                  Open record
                </Link>
                <Link
                  {...itemLink(selected)}
                  className="text-label max-md:hidden"
                >
                  Open
                </Link>
                <p className="mt-1 text-label text-fg-muted md:hidden">
                  Reviewing and signing need a larger screen. Open the record
                  here, or continue on a desktop.
                </p>
              </>
            ) : (
              <Link
                {...(selectedRun.data
                  ? runLink(selectedRun.data)
                  : itemLink(selected))}
                className="text-label"
              >
                {selectedRun.data ? 'Open the run' : 'Open'}
              </Link>
            )}
          </InspectorSection>
        </Inspector>
      ) : null}
    </div>
  )
}
