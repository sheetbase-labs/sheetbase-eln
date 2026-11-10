/**
 * The Inbox route: it composes the page's state, rows and actions from
 * `-inbox-page-model` and hands them to the sections in `-inbox-page-parts`.
 * The tab, the type chip and the open row live in the URL.
 */
import { createFileRoute } from '@tanstack/react-router'

import { inboxSearchSchema, types } from './-inbox-model'
import type { InboxSearch } from './-inbox-model'
import {
  useInboxFilters,
  useInboxList,
  useInboxRows,
  useInboxSelection,
  useInboxShortcuts,
  useInboxViewState,
  useMarkInboxSeen,
} from './-inbox-page-model'
import { InboxHeader, InboxList, InboxToolbar } from './-inbox-page-parts'

/** UI port (roadmap-4/ui-app3): the Inbox, wired to `my_work_items`. */
export const Route = createFileRoute('/inbox')({
  // The Home chips open a specific tab/type here, so the set a chip counts is
  // the set the page shows.
  validateSearch: (search): InboxSearch => inboxSearchSchema.parse(search),
  component: Inbox,
})

function Inbox() {
  const { tab, type } = useInboxFilters()

  const view = useInboxViewState()

  const rows = useInboxRows({ tab, type, later: view.later })
  const list = useInboxList(rows, view.expandedRepeats)

  const shortcuts = useInboxShortcuts({
    orderedRows: list.orderedRows,
    selectedKey: view.selectedKey,
    selectedKeyRef: view.selectedKeyRef,
    setSelectedKey: view.setSelectedKey,
    setSelection: view.setSelection,
  })

  const { selected, selectedCount, selectedSeenKeys, markableKeys } =
    useInboxSelection({
      orderedRows: list.orderedRows,
      visible: rows.visible,
      selection: view.selection,
      tab,
      selectedKey: view.selectedKey,
    })

  const markSeen = useMarkInboxSeen()

  const page = rows.page
  // QA2-Inbox-2: while the read is outstanding the counts are unknown, not
  // zero.
  const countsKnown = Boolean(page)

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <InboxHeader
          hasNextPage={Boolean(rows.query.hasNextPage)}
          markableCount={markableKeys.length}
          marking={markSeen.isPending}
          onMarkSeen={() => markSeen.mutate(markableKeys)}
          tab={tab}
          onSelectTab={view.selectTab}
          countsKnown={countsKnown}
          tabCount={(name) => page?.tabs[name] ?? 0}
        />

        <InboxToolbar
          filterRef={shortcuts.filterRef}
          type={type}
          onSelectType={view.selectType}
          countsKnown={countsKnown}
          typeCount={(name) => page?.types[name] ?? 0}
          selectedCount={selectedCount}
          marking={markSeen.isPending}
          onMarkSelected={() =>
            markSeen.mutate(selectedSeenKeys, {
              onSuccess: () => view.setSelection(new Set()),
            })
          }
          onClearSelection={() => view.setSelection(new Set())}
        />

        <InboxList
          query={rows.query}
          rows={rows}
          orderedRowCount={list.orderedRows.length}
          onExpandLater={() => view.setLater(true)}
          sections={list.sections}
          tab={tab}
          selection={view.selection}
          onSelectionChange={view.setSelection}
          selected={selected}
          expandedRepeats={view.expandedRepeats}
          onExpandedRepeatsChange={view.setExpandedRepeats}
          onOpenItem={shortcuts.openItem}
          onSelectKey={view.setSelectedKey}
          onCollapseLater={() => view.setLater(false)}
          type={type}
          typeLabel={
            type
              ? (types.find(([name]) => name === type)?.[1] ?? type)
              : undefined
          }
          onClearType={() => view.selectType(undefined)}
        />
      </div>
    </div>
  )
}
