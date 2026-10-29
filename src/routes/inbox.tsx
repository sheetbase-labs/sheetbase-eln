import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
  useSearch,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '#/components/v3/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'

import { Button } from '#/components/v3/ui/button'
import { LoadMore } from '#/components/v3/ui/load-more'
import { Dot, Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { useWorkspaceNavigation } from '#/components/workspace/workspace-navigation'
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
  dueLabel,
  groupWorkItems,
  isMachineKey,
  useInboxPage,
} from '#/lib/work-items/data'
import type { WorkItem, WorkItemKind } from '#/lib/work-items/data'
import { itemLink } from '#/lib/work-items/destination'
import { itemKey } from '#/lib/work-items/predicate'
import type { InboxTab, WorkItemType } from '#/lib/work-items/predicate'
import { rich, t } from '#/copy'

type InboxType = WorkItemType
type InboxGroup = 'overdue' | 'today' | 'nextSevenDays' | 'later'

const tabs: [InboxTab, string][] = [
  ['needs-action', t('projects.inbox.tabs.needsAction')],
  ['following', t('projects.inbox.tabs.following')],
  ['done-today', t('projects.inbox.tabs.doneToday')],
]
const types: [InboxType, string, Tone, WorkItemKind][] = [
  ['reviews', t('projects.inbox.types.reviews'), 'review', 'review_requested'],
  ['data', t('projects.inbox.types.data'), 'bad', 'data_issue'],
  ['runs', t('projects.inbox.types.runs'), 'analysis', 'run_failed'],
  [
    'materials',
    t('projects.inbox.types.materials'),
    'warn',
    'material_expiring',
  ],
  ['lab', t('projects.inbox.types.lab'), 'lab', 'sample_awaiting_release'],
  ['admin', t('projects.inbox.types.admin'), 'stored', 'access_requested'],
  ['agents', t('projects.inbox.types.agents'), 'progress', 'agent_proposal'],
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
      search.type === 'agents' ||
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
  if (kind === 'review_returned' || kind === 'approval_unsigned') return 'warn'
  // Lab items share the Lab filter's own colour, apart from Materials.
  if (
    kind === 'sample_awaiting_release' ||
    kind === 'sample_hold_exceeded' ||
    kind === 'calibration_overdue' ||
    kind === 'qualification_requested' ||
    kind === 'qualification_granted'
  )
    return 'lab'
  if (kind === 'agent_proposal') return 'progress'
  if (kind === 'witness_signed') return 'review'
  // A conflict is actionable: two edits need a person to choose between them.
  if (kind === 'cell_conflict') return 'warn'
  return 'stored'
}

/** The type label is always the type; how late it is reads in the due column. */
function labelFor(kind: WorkItemKind): string {
  switch (kind) {
    case 'calibration_overdue':
      return t('projects.inbox.kinds.calibration_overdue')
    case 'qualification_requested':
      return t('projects.inbox.kinds.qualification_requested')
    case 'qualification_granted':
      return t('projects.inbox.kinds.qualification_granted')
    case 'witness_requested':
      return t('projects.inbox.kinds.witness_requested')
    case 'review_requested':
      return t('projects.inbox.kinds.review_requested')
    case 'data_issue':
      return t('projects.inbox.kinds.data_issue')
    case 'run_failed':
      return t('projects.inbox.kinds.run_failed')
    case 'run_waiting':
      return t('projects.inbox.kinds.run_waiting')
    case 'material_expiring':
      return t('projects.inbox.kinds.material_expiring')
    case 'cell_conflict':
      return t('projects.inbox.kinds.cell_conflict')
    case 'review_returned':
      return t('projects.inbox.kinds.review_returned')
    case 'approval_unsigned':
      return t('projects.inbox.kinds.approval_unsigned')
    case 'witness_signed':
      return t('projects.inbox.kinds.witness_signed')
    case 'access_requested':
      return t('projects.inbox.kinds.access_requested')
    case 'access_decided':
      return t('projects.inbox.kinds.access_decided')
    case 'agent_proposal':
      return t('projects.inbox.kinds.agent_proposal')
    case 'invitation_accepted':
      return t('projects.inbox.kinds.invitation_accepted')
    case 'verification_requested':
      return t('projects.inbox.kinds.verification_requested')
    case 'verification_granted':
      return t('projects.inbox.kinds.verification_granted')
    case 'sample_awaiting_release':
      return t('projects.inbox.kinds.sample_awaiting_release')
    case 'sample_hold_exceeded':
      return t('projects.inbox.kinds.sample_hold_exceeded')
    default:
      return t('projects.inbox.kinds.following')
  }
}

/**
 * The second line of a row says what to do. A calibration's reason repeats the
 * due date the row's due column already shows, so it names the action instead.
 */
function rowReason(item: WorkItem): string {
  return item.kind === 'calibration_overdue'
    ? t('projects.inbox.calibrationReason')
    : item.reason
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

function Inbox() {
  const search = useSearch({ from: '/inbox' })
  const tab = search.tab ?? 'needs-action'
  const type = search.type
  const query = useInboxPage(tab, type)
  const page = query.data?.pages.at(0)
  const items = query.data?.pages.flatMap((p) => p.items) ?? []
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

  // Back and Forward move the selection with the address.
  useEffect(() => {
    setSelectedKeyState(search.item ?? null)
  }, [search.item])

  const queryClient = useQueryClient()
  const router = useRouter()
  const workspace = useWorkspaceNavigation()

  const groups = useMemo(() => groupWorkItems(items), [items])
  const visible = items
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
  const hiddenLater = groups.later.length
  const sections: [InboxGroup | null, WorkItem[]][] = useMemo(
    () =>
      tab === 'needs-action'
        ? [
            [
              'overdue',
              groups.overdue.filter((i) => visibleKeys.has(itemKey(i))),
            ],
            ['today', groups.today.filter((i) => visibleKeys.has(itemKey(i)))],
            [
              'nextSevenDays',
              groups.nextSevenDays.filter((i) => visibleKeys.has(itemKey(i))),
            ],
            [
              'later',
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
  const selectedCount = orderedRows.filter((item) =>
    selection.has(rowKey(item)),
  ).length

  // Bulk select: the checked rows that still need action are what "Mark
  // selected seen" acts on.
  const selectedSeenKeys = useMemo(
    () =>
      orderedRows
        .filter((item) => selection.has(rowKey(item)) && tab === 'needs-action')
        .map(itemKey),
    [orderedRows, selection, tab],
  )

  const tabCount = (name: InboxTab) => page?.tabs[name] ?? 0
  const typeCount = (name: InboxType) => page?.types[name] ?? 0
  const typeLabel = type
    ? (types.find(([name]) => name === type)?.[1] ?? type)
    : undefined

  // QA2-Inbox-2: while the read is outstanding the counts are unknown, not
  // zero. Stating 0 made the page disagree with the sidebar and hid the fact
  // that nothing had answered yet.
  const countsKnown = Boolean(page)

  // QA3-inbox-1 — "Mark all seen" acts on the items the current tab and type
  // chip show, not on every needs-action item. On Following and Done today
  // there is nothing of the sort on screen, and a type chip narrows the list,
  // so marking the rest reported success for work the person could not see.
  const markableKeys = useMemo(
    () => (tab === 'needs-action' ? visible.map(itemKey) : []),
    [visible, tab],
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
    setLater(null)
    updateSearch({
      tab: next === 'needs-action' ? undefined : next,
      type: undefined,
      item: undefined,
    })
  }
  const selectType = (next: InboxType | undefined) => {
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
  const openItem = useCallback(
    // Like any other link an item opens in this pane; Alt-click opens beside.
    async (item: WorkItem, beside = false) => {
      const runId =
        item.kind === 'run_failed' || item.kind === 'run_waiting'
          ? await resolveRunForWorkItem(item).catch(() => null)
          : null
      const destination = runId ? runLink(runId) : itemLink(item)
      if (workspace && beside) {
        const { href } = router.buildLocation(destination)
        workspace.open(href, { beside: true, title: item.title })
      } else void navigate(destination)
    },
    [navigate, router, workspace],
  )
  const openSelected = useCallback(() => {
    const item =
      rowsRef.current.find((i) => rowKey(i) === selectedKeyRef.current) ??
      rowsRef.current.at(0)
    if (item) void openItem(item)
  }, [openItem])
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
      toast(t('projects.inbox.markedSeen'))
      void queryClient.invalidateQueries({ queryKey: ['work-items'] })
      // The Inbox badge and Home counts come from the router context, which
      // only a route re-resolution refreshes.
      void router.invalidate()
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : t('projects.inbox.markFailed'),
      ),
  })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ListHeader
          title={t('projects.inbox.title')}
          subtitle={t('projects.inbox.subtitle')}
          actions={
            <>
              <Button
                nativeButton={false}
                render={<Link to="/settings/notifications" />}
              >
                {t('projects.inbox.notificationSettings')}
              </Button>
              <Button
                disabled={markSeen.isPending || markableKeys.length === 0}
                onClick={() => markSeen.mutate(markableKeys)}
              >
                {query.hasNextPage
                  ? t('projects.inbox.markLoaded')
                  : t('projects.inbox.markAll')}
              </Button>
            </>
          }
          tabs={
            <Tabs
              mode="state"
              label={t('projects.inbox.title')}
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
          aria-label={t('projects.inbox.filterByType')}
          className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 md:px-6 [&>button]:shrink-0"
        >
          <Button
            size="sm"
            variant="quiet"
            aria-pressed={!type}
            className={!type ? 'bg-selection hover:bg-selection' : undefined}
            onClick={() => selectType(undefined)}
          >
            {t('projects.inbox.allTypes')}
          </Button>
          {types.map(([name, label, tone]) => (
            <Button
              key={name}
              size="sm"
              variant="quiet"
              aria-pressed={type === name}
              className={
                type === name ? 'bg-selection hover:bg-selection' : undefined
              }
              onClick={() => selectType(type === name ? undefined : name)}
            >
              <Dot tone={tone} />
              {label} {countsKnown ? typeCount(name) : '—'}
            </Button>
          ))}
          <span className="flex-1" />
          {selectedCount > 0 ? (
            <>
              <span role="status" className="text-label text-fg-muted">
                {t('projects.inbox.selected', { count: selectedCount })}
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
                {t('projects.inbox.markSelected')}
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setSelection(new Set())}
              >
                {t('projects.inbox.clearSelection')}
              </Button>
            </>
          ) : null}
          <span className="shrink-0 whitespace-nowrap text-label text-fg-muted max-lg:hidden">
            {rich('projects.inbox.sorted', {
              kbd: (key) => <Kbd>{key}</Kbd>,
            })}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {query.isError && !page ? (
            <div
              role="alert"
              className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
            >
              <div className="text-prose font-semibold">
                {t('projects.inbox.loadFailed')}
              </div>
              <div className="max-w-[460px] leading-[19px] text-fg-muted">
                {query.error instanceof Error
                  ? query.error.message
                  : t('projects.inbox.loadFailedBody')}
              </div>
              <Button
                size="sm"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {query.isFetching
                  ? t('projects.inbox.trying')
                  : t('common.actions.tryAgain')}
              </Button>
            </div>
          ) : orderedRows.length === 0 && hiddenLater === 0 ? (
            <div
              role="status"
              className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
            >
              <div className="text-prose font-semibold">
                {query.isPending
                  ? t('common.states.loading')
                  : t('projects.inbox.empty.title')}
              </div>
              <div className="max-w-[460px] leading-[19px] text-fg-muted">
                {type
                  ? t('projects.inbox.empty.type', { type: typeLabel ?? '' })
                  : tab === 'following'
                    ? t('projects.inbox.empty.following')
                    : tab === 'done-today'
                      ? t('projects.inbox.empty.doneToday')
                      : t('projects.inbox.empty.needsAction')}
              </div>
              {/* QA3-inbox-2 — the type chips narrow the list, so the state
                  that empties it offers the way back. */}
              {type ? (
                <Button size="sm" onClick={() => selectType(undefined)}>
                  {t('projects.inbox.clearFilter')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div role="list" aria-label={t('projects.inbox.items')}>
              {sections.map(([g, rows]) => {
                if (!rows.length) return null
                return (
                  <div key={g ?? 'all'}>
                    <div
                      role="presentation"
                      className="flex h-8 items-center gap-2 border-b border-border-subtle bg-surface-muted px-4 text-label font-medium text-fg-muted md:px-6"
                    >
                      {g
                        ? t(`projects.inbox.groups.${g}`)
                        : tabs.find(([name]) => name === tab)![1]}
                      {/* QA3-lists-inbox-2 — the tab's own group states the
                          tab's total, so the strip and the list agree in one
                          viewport; a due-date group states its own rows. */}
                      <span className="num font-normal">
                        {g === null ? visible.length : rows.length}
                      </span>
                      {g === 'later' ? (
                        <button
                          type="button"
                          aria-expanded
                          onClick={() => setLater(false)}
                          className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-label text-link"
                        >
                          {t('projects.inbox.collapse')}
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
                          className={cn(
                            'flex items-center hover:bg-row-hover',
                            (selected === i || selection.has(key)) &&
                              'bg-selection hover:bg-selection',
                          )}
                          aria-current={selected === i ? true : undefined}
                        >
                          <Checkbox
                            className="ml-4 md:ml-6"
                            aria-label={t('projects.inbox.select', {
                              title: i.title,
                            })}
                            checked={selection.has(key)}
                            onCheckedChange={(checked) =>
                              setSelection((current) => {
                                const next = new Set(current)
                                if (checked) next.add(key)
                                else next.delete(key)
                                return next
                              })
                            }
                          />
                          <button
                            type="button"
                            aria-pressed={selection.has(key)}
                            onFocus={() => setSelectedKey(key)}
                            onClick={(event) => {
                              setSelectedKey(key)
                              if (
                                !event.ctrlKey &&
                                !event.metaKey &&
                                !event.shiftKey
                              ) {
                                void openItem(i, event.altKey)
                                return
                              }
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
                              'grid min-h-11 w-full cursor-pointer grid-cols-[104px_minmax(0,1fr)_180px] items-center gap-3 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1 max-md:py-2 border-0 border-b border-border-subtle bg-transparent px-4 py-1.5 text-left md:px-6',
                            )}
                          >
                            <Status
                              tone={toneFor(i.kind)}
                              className="min-w-0 whitespace-normal max-md:col-span-2 max-md:justify-self-start"
                            >
                              {labelFor(i.kind)}
                            </Status>
                            <span className="min-w-0">
                              <span className="block truncate text-body font-medium text-fg">
                                {i.identifier && !isMachineKey(i.identifier) ? (
                                  <span className="mono mr-1.5 font-normal text-fg-muted">
                                    {i.identifier}
                                  </span>
                                ) : null}
                                {i.title}
                                {selection.has(key) ? (
                                  <span className="ml-2 text-label text-link">
                                    {t('projects.inbox.selectedRow')}
                                  </span>
                                ) : null}
                              </span>
                              <span className="block truncate text-label text-fg-muted">
                                {rowReason(i)}
                              </span>
                            </span>
                            <span className="whitespace-nowrap text-right text-label text-fg-muted max-md:max-w-[9rem] max-md:whitespace-normal">
                              {dueLabel(i.dueAt)}
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
              {t('projects.inbox.laterItems', { count: hiddenLater })}
            </button>
          ) : null}
          {page ? (
            <LoadMore
              label={t('projects.inbox.pages')}
              hasMore={Boolean(query.hasNextPage)}
              loading={query.isFetchingNextPage}
              error={
                query.isFetchNextPageError
                  ? t('projects.inbox.loadMoreFailed')
                  : undefined
              }
              onLoadMore={() => void query.fetchNextPage()}
              loaded={items.length}
              total={page.total}
              noun={t('projects.inbox.noun')}
              className="px-4 py-3 md:px-6"
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
