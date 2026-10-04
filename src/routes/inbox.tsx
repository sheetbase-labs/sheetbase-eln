import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
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
import {
  useRegisterShortcuts,
  useShortcutScope,
} from '#/components/shortcuts/shortcut-provider'
import { listShortcuts } from '#/lib/shortcut-scopes'
import { cn } from '#/lib/utils'
import { groupWorkItems, useWorkItems } from '#/lib/work-items/data'
import type { WorkItem, WorkItemKind } from '#/lib/work-items/data'

type InboxTab = 'needs-action' | 'following' | 'done-today'
type InboxType = 'reviews' | 'data' | 'runs' | 'materials' | 'following'

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
  ['following', 'Following', 'stored', 'following'],
]

/** UI port (roadmap-4/ui-app3): the Inbox, wired to `my_work_items`. */
export const Route = createFileRoute('/inbox')({
  component: Inbox,
})

function kindToType(kind: WorkItemKind): InboxType {
  if (kind === 'review_requested' || kind === 'witness_requested')
    return 'reviews'
  if (kind === 'data_issue') return 'data'
  if (kind === 'run_failed') return 'runs'
  if (kind === 'material_expiring') return 'materials'
  return 'following'
}

function toneFor(kind: WorkItemKind): Tone {
  if (kind === 'review_requested' || kind === 'witness_requested')
    return 'review'
  if (kind === 'data_issue') return 'bad'
  if (kind === 'run_failed') return 'bad'
  if (kind === 'material_expiring') return 'warn'
  return 'stored'
}

function labelFor(kind: WorkItemKind, state: string): string {
  if (kind === 'witness_requested') return 'Witness requested'
  if (state === 'overdue') return 'Overdue'
  if (kind === 'review_requested') return 'Review'
  if (kind === 'data_issue') return 'Data issue'
  if (kind === 'run_failed') return 'Failed'
  if (kind === 'material_expiring') return 'Material'
  return 'Following'
}

/** Stable key for an Inbox item across reloads. */
export function itemKey(item: WorkItem): string {
  return `${item.kind}:${item.sourceId ?? item.recordId ?? item.identifier ?? item.title}`
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

function itemTab(item: WorkItem, seen: Set<string>): InboxTab {
  if (item.state === 'following' || item.kind === 'following')
    return 'following'
  if (seen.has(itemKey(item)) || item.state === 'done_today')
    return 'done-today'
  return 'needs-action'
}

export function itemLink(item: WorkItem) {
  if (item.kind === 'witness_requested')
    return item.revisionId
      ? {
          to: '/review/$revisionId' as const,
          params: { revisionId: item.revisionId },
          search: { signatureMeaning: 'witnessed' as const },
        }
      : { to: '/inbox' as const }
  if (item.sourceType === 'connector_run' && item.connectorId)
    return {
      to: '/settings/integrations/$connectorId' as const,
      params: { connectorId: item.connectorId },
    }
  if (item.sourceType === 'dataset_import_file' && item.sourceId)
    return {
      to: '/settings/instruments' as const,
      search: {
        fileId: item.sourceId,
        versionId: item.parserVersionId ?? undefined,
      },
    }
  if (item.kind === 'run_failed') return { to: '/pipelines' as const }
  if (item.kind === 'data_issue') return { to: '/datasets' as const }
  if (item.kind === 'material_expiring') return { to: '/materials' as const }
  if (item.recordId)
    return {
      to: '/records/$recordId' as const,
      params: { recordId: item.recordId },
    }
  return { to: '/inbox' as const }
}

function Inbox() {
  const query = useWorkItems()
  const items = query.data ?? []
  const [tab, setTab] = useState<InboxTab>('needs-action')
  const [type, setType] = useState<InboxType | undefined>(undefined)
  const [later, setLater] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(() => new Set())

  const queryClient = useQueryClient()
  const seenQuery = useQuery({
    queryKey: ['ui-port', 'inbox', 'seen'],
    queryFn: async () => {
      const rows = await notebookDataClient.list<{ item_key: string }>(
        'work_item_views',
        '?select=item_key',
      )
      return new Set(rows.map((r) => r.item_key))
    },
    staleTime: 15_000,
  })
  const seen = seenQuery.data ?? new Set<string>()

  const groups = useMemo(() => groupWorkItems(items), [items])
  const inTab = items.filter((i) => itemTab(i, seen) === tab)
  const visible = inTab.filter((i) => !type || kindToType(i.kind) === type)
  const visibleKeys = useMemo(
    () => new Set(visible.map((i) => itemKey(i))),
    [visible],
  )
  const shown = visible.filter((i) => later || !groups.later.includes(i))
  const hiddenLater = groups.later.filter(
    (i) => itemTab(i, seen) === tab && (!type || kindToType(i.kind) === type),
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
              later
                ? groups.later.filter((i) => visibleKeys.has(itemKey(i)))
                : [],
            ],
          ]
        : [[null, shown]],
    [tab, groups, later, shown, visibleKeys],
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

  const tabCount = (t: InboxTab) =>
    items.filter((i) => itemTab(i, seen) === t).length
  const typeCount = (t: InboxType) =>
    inTab.filter((i) => kindToType(i.kind) === t).length

  const needsActionKeys = items
    .filter((i) => itemTab(i, seen) === 'needs-action')
    .map(itemKey)

  // SHELL-03.3 — the List scope through the single shortcut registry. The
  // ordered rows and the current selection live in refs so the registered
  // handlers stay stable and the provider does not re-register every render.
  const navigate = useNavigate()
  const filterRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<WorkItem[]>(orderedRows)
  const selectedKeyRef = useRef<string | null>(selectedKey)
  useEffect(() => {
    rowsRef.current = orderedRows
    selectedKeyRef.current = selectedKey
  }, [orderedRows, selectedKey])
  const move = useCallback((delta: number) => {
    setSelectedKey((current) =>
      moveListSelection(rowsRef.current.map(rowKey), current, delta),
    )
  }, [])
  const openSelected = useCallback(() => {
    const item =
      rowsRef.current.find((i) => rowKey(i) === selectedKeyRef.current) ??
      rowsRef.current.at(0)
    if (item) void navigate(itemLink(item) as never)
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
      void queryClient.invalidateQueries({ queryKey: ['ui-port', 'inbox'] })
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : 'Couldn’t mark them.',
      ),
  })

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-1 border-b border-border px-4 pt-4 md:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-title">Inbox</h1>
            <span className="ml-1 text-body text-fg-muted max-md:hidden">
              Everything waiting on you, across projects
            </span>
            <span className="flex-1" />
            <Button
              nativeButton={false}
              render={<Link to="/settings/notifications" />}
            >
              Notification settings
            </Button>
            <Button
              disabled={markSeen.isPending || needsActionKeys.length === 0}
              onClick={() => markSeen.mutate(needsActionKeys)}
            >
              Mark all seen
            </Button>
          </div>
          <div
            role="tablist"
            aria-label="Inbox"
            className="mt-1 flex gap-5 overflow-x-auto [scrollbar-width:none]"
          >
            {tabs.map(([t, l]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t)
                  setType(undefined)
                  setLater(false)
                }}
                className={cn(
                  'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted hover:text-fg max-md:h-11',
                  tab === t && 'border-link text-fg',
                )}
              >
                {l}
                <span className="text-label font-normal text-fg-muted">
                  {tabCount(t)}
                </span>
              </button>
            ))}
          </div>
        </header>

        <div
          ref={filterRef}
          role="toolbar"
          aria-label="Filter by type"
          className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 py-2 [scrollbar-width:none] md:px-6 [&>button]:shrink-0"
        >
          <Button
            size="sm"
            variant="quiet"
            aria-pressed={!type}
            className={!type ? 'bg-selection hover:bg-selection' : undefined}
            onClick={() => setType(undefined)}
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
              onClick={() => setType(type === t ? undefined : t)}
            >
              <Dot tone={tone} />
              {l} {typeCount(t)}
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
          {orderedRows.length === 0 && hiddenLater === 0 ? (
            <div
              role="status"
              className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
            >
              <div className="text-prose font-semibold">
                {query.isLoading ? 'Loading…' : 'Nothing here'}
              </div>
              <div className="max-w-[460px] leading-[19px] text-fg-muted">
                {tab === 'following'
                  ? 'Records you follow appear here.'
                  : 'Nothing needs your action right now.'}
              </div>
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
                      <span className="num font-normal">{rows.length}</span>
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
                    {rows.map((i) => {
                      const key = rowKey(i)
                      return (
                        <div
                          key={key}
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
                            <Status tone={toneFor(i.kind)}>
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
          {hiddenLater > 0 && !later ? (
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
            <Link {...itemLink(selected)} className="text-label">
              Open
            </Link>
          </InspectorSection>
        </Inspector>
      ) : null}
    </div>
  )
}
