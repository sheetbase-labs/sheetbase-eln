/**
 * The Inbox's state, rows and actions.
 *
 * The route's component used to read the page, derive the due-date sections and
 * hold four pieces of selection state in one function. Each of those now has a
 * hook of its own here, composed by the route, which only renders.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from '#/components/ui/sonner'
import { notebookDataClient } from '#/lib/notebook-data'
import { groupWorkItems, useInboxPage } from '#/lib/work-items/data'
import type { WorkItem } from '#/lib/work-items/data'
import {
  itemLink,
  moveListSelection,
  rowKey,
  runLink,
} from '#/lib/work-items/inbox-rows'
import type { InboxTab } from '#/lib/work-items/predicate'
import { itemKey } from '#/lib/work-items/predicate'
import { resolveRunForWorkItem } from '#/components/pipelines/pipelines-data'
import { useWorkspaceNavigation } from '#/components/workspace/workspace-navigation'
import {
  useRegisterShortcuts,
  useShortcutScope,
} from '#/components/shortcuts/shortcut-provider'
import { listShortcuts } from '#/lib/shortcut-scopes'
import { t } from '#/copy'

import {
  inboxDueSections,
  inboxSearchSchema,
  inboxSections,
  inboxSelectionCounts,
  laterHoldsEveryRow,
  orderedInboxRows,
  selectedInboxRow,
  visibleInboxRows,
} from './-inbox-model'
import type { InboxSearch, InboxType } from './-inbox-model'

/** The tab and the type chip, read from the address bar. */
export function useInboxFilters() {
  const search = useSearch({ from: '/inbox' })

  return { tab: search.tab ?? 'needs-action', type: search.type }
}

/**
 * The selection state and the URL that mirrors it: the open row, the checked
 * rows, the repeat groups the person opened, and whether Later is expanded.
 */
export function useInboxViewState() {
  const search = useSearch({ from: '/inbox' })

  // QA3-lists-inbox-2 — `later` is the person's explicit choice: null means
  // "follow the default", which expands the bucket when it holds every row the
  // tab would render.
  const [later, setLater] = useState<boolean | null>(null)

  const [selectedKey, setSelectedKeyState] = useState<string | null>(
    () => search.item ?? null,
  )

  const [selection, setSelection] = useState<Set<string>>(() => new Set())

  // Repeat groups the person has opened to see each item.
  const [expandedRepeats, setExpandedRepeats] = useState<Set<string>>(
    () => new Set(),
  )

  // Back and Forward move the selection with the address.
  useEffect(() => {
    setSelectedKeyState(search.item ?? null)
  }, [search.item])

  const navigate = useNavigate()

  // QA3-inbox-4 — the tab and the type chips write the URL, so a reload and
  // Back agree with the list on screen. The URL was only ever read: clicking
  // Following left `?type=reviews` in the address bar and a reload restored
  // the old filter.
  const updateSearch = useCallback(
    (patch: InboxSearch) => {
      void navigate({
        to: '/inbox',
        // The router hands the updater every route's search; this page reads
        // its own three keys and passes nothing else on.
        search: (previous) => {
          const current = inboxSearchSchema.parse(previous)

          return {
            tab: 'tab' in patch ? patch.tab : current.tab,
            type: 'type' in patch ? patch.type : current.type,
            item: 'item' in patch ? patch.item : current.item,
          }
        },
      })
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
        search: (previous) => ({
          ...inboxSearchSchema.parse(previous),
          item: key ?? undefined,
        }),
        replace: true,
      })
    },
    [navigate],
  )

  const selectTab = useCallback(
    (next: InboxTab) => {
      setLater(null)
      updateSearch({
        tab: next === 'needs-action' ? undefined : next,
        type: undefined,
        item: undefined,
      })
    },
    [updateSearch],
  )

  const selectType = useCallback(
    (next: InboxType | undefined) => {
      updateSearch({ type: next })
    },
    [updateSearch],
  )

  return {
    later,
    setLater,
    selection,
    setSelection,
    expandedRepeats,
    setExpandedRepeats,
    selectedKey,
    selectedKeyRef,
    setSelectedKey,
    updateSearch,
    selectTab,
    selectType,
  }
}

export type InboxViewState = ReturnType<typeof useInboxViewState>

/**
 * The page of work items and the due-date sections it draws, with the Later
 * bucket's own collapse rule.
 */
export function useInboxRows({
  tab,
  type,
  later,
}: {
  tab: InboxTab
  type: InboxType | undefined
  later: boolean | null
}) {
  const query = useInboxPage(tab, type)
  const page = query.data?.pages.at(0)

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  )

  const groups = useMemo(() => groupWorkItems(items), [items])
  const visible = items

  const visibleKeys = useMemo(
    () => new Set(visible.map((i) => itemKey(i))),
    [visible],
  )

  const laterKeys = useMemo(() => new Set(groups.later), [groups.later])

  const laterExpanded = later ?? laterHoldsEveryRow(visible, laterKeys)

  const shown = visibleInboxRows({ visible, laterExpanded, laterKeys })

  const hiddenLater = groups.later.length

  const dueSections = useMemo(
    () => inboxDueSections({ tab, groups, visibleKeys, laterExpanded, shown }),
    [tab, groups, laterExpanded, shown, visibleKeys],
  )

  return {
    query,
    page,
    items,
    visible,
    hiddenLater,
    laterExpanded,
    dueSections,
  }
}

export type InboxRows = ReturnType<typeof useInboxRows>

/**
 * The list as it is drawn: repeat groups unfold on request, so the sections the
 * person sees are derived from the state that owns which groups are open.
 */
export function useInboxList(
  rows: InboxRows,
  expandedRepeats: ReadonlySet<string>,
) {
  const sections = useMemo(
    () => inboxSections(rows.dueSections, expandedRepeats),
    [rows.dueSections, expandedRepeats],
  )

  const orderedRows = useMemo(() => orderedInboxRows(sections), [sections])

  return { sections, orderedRows }
}

/** The open row, and what the toolbar and bulk actions count from it. */
export function useInboxSelection({
  orderedRows,
  visible,
  selection,
  tab,
  selectedKey,
}: {
  orderedRows: readonly WorkItem[]
  visible: readonly WorkItem[]
  selection: ReadonlySet<string>
  tab: InboxTab
  selectedKey: string | null
}) {
  const selected = selectedInboxRow(orderedRows, selectedKey)

  const counts = useMemo(
    () => inboxSelectionCounts({ visible, selection, tab }),
    [visible, selection, tab],
  )

  return { selected, ...counts }
}

/**
 * SHELL-03.3 — the List scope through the single shortcut registry, plus the one
 * way a row opens. The ordered rows and the current selection live in refs so
 * the registered handlers stay stable and the provider does not re-register
 * every render.
 */
export function useInboxShortcuts({
  orderedRows,
  selectedKey,
  selectedKeyRef,
  setSelectedKey,
  setSelection,
}: {
  orderedRows: readonly WorkItem[]
  selectedKey: string | null
  selectedKeyRef: React.RefObject<string | null>
  setSelectedKey: (key: string | null) => void
  setSelection: React.Dispatch<React.SetStateAction<Set<string>>>
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const workspace = useWorkspaceNavigation()
  const filterRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef<WorkItem[]>([...orderedRows])

  useEffect(() => {
    rowsRef.current = [...orderedRows]
    selectedKeyRef.current = selectedKey
  }, [orderedRows, selectedKey, selectedKeyRef])

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
    [selectedKeyRef, setSelectedKey],
  )

  const openItem = useCallback(
    // Like any other link an item opens in this pane; Alt-click opens beside
    // and Alt+Shift-click below.
    async (item: WorkItem, where?: 'beside' | 'below') => {
      const runId =
        item.kind === 'run_failed' || item.kind === 'run_waiting'
          ? await resolveRunForWorkItem(item).catch(() => null)
          : null

      const destination = runId ? runLink(runId) : itemLink(item)

      if (workspace && where) {
        const { href } = router.buildLocation(destination)

        const placement: Parameters<typeof workspace.open>[1] = {
          beside: true,
          title: item.title,
        }

        if (where === 'below') placement.below = true

        workspace.open(href, placement)
      } else void navigate(destination)
    },
    [navigate, router, workspace],
  )

  const openSelected = useCallback(() => {
    const item =
      rowsRef.current.find((i) => rowKey(i) === selectedKeyRef.current) ??
      rowsRef.current.at(0)

    if (item) void openItem(item)
  }, [openItem, selectedKeyRef])

  const selectCurrent = useCallback(
    (add: boolean) => {
      const item =
        rowsRef.current.find((i) => rowKey(i) === selectedKeyRef.current) ??
        rowsRef.current.at(0)

      if (!item) return
      setSelection(
        (current) => new Set([...(add ? current : []), rowKey(item)]),
      )
    },
    [selectedKeyRef, setSelection],
  )

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

  return { filterRef, openItem }
}

/** Marking work items seen, and the reads a successful mark has to refresh. */
export function useMarkInboxSeen() {
  const queryClient = useQueryClient()
  const router = useRouter()

  return useMutation({
    mutationFn: (keys: string[]) =>
      notebookDataClient.rpc('mark_work_items_seen', { p_item_keys: keys }),
    onSuccess: () => {
      toast(t('projects.inbox.markedSeen'))
      void queryClient.invalidateQueries({ queryKey: ['work-items'] })
      // The Inbox badge and Home counts come from the router context, which
      // only a route re-resolution refreshes.
      void router.invalidate()
    },
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A refused mark-seen is a caught throw, so it reaches this callback untyped; Error supplies its message.
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : t('projects.inbox.markFailed'),
      ),
  })
}
