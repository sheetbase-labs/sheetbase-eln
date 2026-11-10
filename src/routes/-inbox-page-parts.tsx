/**
 * The Inbox's rendered sections: the page header, the type chips and bulk
 * actions, the grouped rows, and the list body with its loading, empty and
 * failed states.
 */
import type { Dispatch, RefObject, SetStateAction } from 'react'

import { Icon } from '#/components/icons'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { LoadMore } from '#/components/ui/load-more'
import { Dot, Status } from '#/components/ui/status'
import { Checkbox } from '#/components/ui/checkbox'
import { Kbd } from '#/components/ui/kbd'
import { Tabs } from '#/components/ui/tabs'
import { ListHeader, PHONE_SCROLL_ROW } from '#/components/inventory/list'
import { cn } from '#/lib/utils'
import { dueLabel, isMachineKey } from '#/lib/work-items/data'
import type { WorkItem } from '#/lib/work-items/data'
import type { InboxTab } from '#/lib/work-items/predicate'
import { rowKey } from '#/lib/work-items/inbox-rows'
import { rich, t } from '#/copy'

import {
  isInboxTab,
  labelFor,
  rowReason,
  tabLabels,
  tabs,
  toneFor,
  types,
} from './-inbox-model'
import type { InboxEntry } from '#/lib/work-items/repeats'
import type { InboxSection, InboxType } from './-inbox-model'
import type { InboxRows } from './-inbox-page-model'

/** The page header: what the Inbox is, its mark-seen action and its tabs. */
export function InboxHeader({
  hasNextPage,
  markableCount,
  marking,
  onMarkSeen,
  tab,
  onSelectTab,
  countsKnown,
  tabCount,
}: {
  hasNextPage: boolean
  markableCount: number
  marking: boolean
  onMarkSeen: () => void
  tab: InboxTab
  onSelectTab: (tab: InboxTab) => void
  countsKnown: boolean
  tabCount: (name: InboxTab) => number
}): React.ReactElement {
  return (
    <ListHeader
      title={t('projects.inbox.title')}
      subtitle={t('projects.inbox.subtitle')}
      actions={
        <>
          <Button
            nativeButton={false}
            render={<Link to="/settings/account/notifications" />}
          >
            {t('projects.inbox.notificationSettings')}
          </Button>
          <Button
            disabled={marking || markableCount === 0}
            onClick={onMarkSeen}
          >
            {hasNextPage
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
          onValueChange={(next) => {
            if (isInboxTab(next)) onSelectTab(next)
          }}
          className="mt-1"
          items={tabs.map(([key, label]) => ({
            key,
            label,
            count: countsKnown ? tabCount(key) : '—',
          }))}
        />
      }
    />
  )
}

/** The type chips, the bulk actions and the sort hint above the list. */
export function InboxToolbar({
  filterRef,
  type,
  onSelectType,
  countsKnown,
  typeCount,
  selectedCount,
  marking,
  onMarkSelected,
  onClearSelection,
}: {
  filterRef: RefObject<HTMLDivElement | null>
  type: InboxType | undefined
  onSelectType: (type: InboxType | undefined) => void
  countsKnown: boolean
  typeCount: (name: InboxType) => number
  selectedCount: number
  marking: boolean
  onMarkSelected: () => void
  onClearSelection: () => void
}): React.ReactElement {
  return (
    <div
      ref={filterRef}
      role="toolbar"
      aria-label={t('projects.inbox.filterByType')}
      className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2 md:px-6 [&_button]:shrink-0"
    >
      {/* On a phone the type filters scroll sideways in one row rather
              than wrapping onto three above the first item. */}
      <div className={PHONE_SCROLL_ROW}>
        <Button
          size="sm"
          variant="quiet"
          aria-pressed={!type}
          className={!type ? 'bg-selection hover:bg-selection' : undefined}
          onClick={() => onSelectType(undefined)}
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
            onClick={() => onSelectType(type === name ? undefined : name)}
          >
            <Dot tone={tone} />
            {label} {countsKnown ? typeCount(name) : '—'}
          </Button>
        ))}
      </div>
      <span className="flex-1" />
      {selectedCount > 0 ? (
        <>
          <span role="status" className="text-label text-fg-muted">
            {t('projects.inbox.selected', { count: selectedCount })}
          </span>
          <Button
            size="sm"
            variant="quiet"
            disabled={marking || selectedCount === 0}
            onClick={onMarkSelected}
          >
            {t('projects.inbox.markSelected')}
          </Button>
          <Button size="sm" variant="quiet" onClick={onClearSelection}>
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
  )
}

/** The grouped rows: due-date sections on Needs action, one list elsewhere. */
export function InboxSections({
  sections,
  tab,
  visibleCount,
  selection,
  onSelectionChange,
  selected,
  expandedRepeats,
  onExpandedRepeatsChange,
  onOpenItem,
  onSelectKey,
  onCollapseLater,
}: {
  sections: InboxSection[]
  tab: InboxTab
  visibleCount: number
  selection: Set<string>
  onSelectionChange: Dispatch<SetStateAction<Set<string>>>
  selected: WorkItem | undefined
  expandedRepeats: Set<string>
  onExpandedRepeatsChange: Dispatch<SetStateAction<Set<string>>>
  onOpenItem: (item: WorkItem, where?: 'beside' | 'below') => Promise<void>
  onSelectKey: (key: string | null) => void
  onCollapseLater: () => void
}): React.ReactElement {
  return (
    <ul aria-label={t('projects.inbox.items')} className="m-0 list-none p-0">
      {sections.map(([g, rows, entries]) => {
        if (!rows.length) return null

        return (
          <div key={g ?? 'all'}>
            <div
              role="presentation"
              className="flex h-8 items-center gap-2 border-b border-border-subtle bg-surface-muted px-4 text-label font-medium text-fg-muted md:px-6"
            >
              {g ? t(`projects.inbox.groups.${g}`) : (tabLabels.get(tab) ?? '')}
              {/* QA3-lists-inbox-2 — the tab's own group states the
                          tab's total, so the strip and the list agree in one
                          viewport; a due-date group states its own rows. */}
              <span className="num font-normal">
                {g === null ? visibleCount : rows.length}
              </span>
              {g === 'later' ? (
                <button
                  type="button"
                  aria-expanded
                  onClick={onCollapseLater}
                  className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-label text-link"
                >
                  {t('projects.inbox.collapse')}
                </button>
              ) : null}
            </div>
            {entries.map((entry, index) => (
              // QA3-lists-inbox-1 — `rowKey` mirrors the boundary identity,
              // but distinct work items can share it (many data issues carry
              // one dataset's identifier), and duplicate keys leave removed
              // rows on screen. The position disambiguates the rendered
              // siblings; `key` still drives selection.
              // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- Rows that share a boundary identity are told apart by their position here; `key` still drives selection.
              <InboxRow
                key={`${rowKey(entry.item)}#${index}`}
                entry={entry}
                selected={selected}
                selection={selection}
                expandedRepeats={expandedRepeats}
                onSelectionChange={onSelectionChange}
                onExpandedRepeatsChange={onExpandedRepeatsChange}
                onOpenItem={onOpenItem}
                onSelectKey={onSelectKey}
              />
            ))}
          </div>
        )
      })}
    </ul>
  )
}

/**
 * One listed work item: the checkbox that folds it into a repeat group, the row
 * itself and, for a folded group, the control that opens it.
 */
export function InboxRow({
  entry,
  selected,
  selection,
  expandedRepeats,
  onSelectionChange,
  onExpandedRepeatsChange,
  onOpenItem,
  onSelectKey,
}: {
  entry: InboxEntry
  selected: WorkItem | undefined
  selection: Set<string>
  expandedRepeats: Set<string>
  onSelectionChange: Dispatch<SetStateAction<Set<string>>>
  onExpandedRepeatsChange: Dispatch<SetStateAction<Set<string>>>
  onOpenItem: (item: WorkItem, where?: 'beside' | 'below') => Promise<void>
  onSelectKey: (key: string | null) => void
}): React.ReactElement {
  const i = entry.item
  const key = rowKey(i)

  // The row standing for a folded group selects all of it.
  const keys =
    entry.count > 1 && !expandedRepeats.has(entry.group)
      ? entry.members.map(rowKey)
      : [key]

  const checked = keys.every((k) => selection.has(k))
  const open = expandedRepeats.has(entry.group)

  return (
    <li
      className={cn(
        'flex items-center hover:bg-row-hover',
        (selected === i || selection.has(key)) &&
          'bg-selection hover:bg-selection',
        entry.repeat && 'bg-surface-muted',
      )}
      aria-current={selected === i ? true : undefined}
    >
      <Checkbox
        className="ml-4 md:ml-6"
        aria-label={t('projects.inbox.select', { title: i.title })}
        checked={checked}
        onCheckedChange={(next) =>
          onSelectionChange((current) => {
            const updated = new Set(current)

            for (const k of keys) {
              if (next) updated.add(k)
              else updated.delete(k)
            }

            return updated
          })
        }
      />
      <button
        type="button"
        aria-pressed={selection.has(key)}
        onFocus={() => onSelectKey(key)}
        onClick={(event) => {
          onSelectKey(key)

          if (
            !event.ctrlKey &&
            !event.metaKey &&
            (!event.shiftKey || event.altKey)
          ) {
            void onOpenItem(
              i,
              event.altKey ? (event.shiftKey ? 'below' : 'beside') : undefined,
            )

            return
          }

          onSelectionChange(
            (current) =>
              new Set([
                ...(event.ctrlKey || event.metaKey ? current : []),
                key,
              ]),
          )
        }}
        className={cn(
          'grid min-h-11 w-full cursor-pointer grid-cols-[104px_minmax(0,1fr)_180px] items-center gap-3 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3 max-md:gap-y-1 max-md:py-2 border-0 border-b border-border-subtle bg-transparent px-4 py-1.5 text-left md:px-6',
          entry.repeat && 'pl-8 md:pl-10',
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
      {entry.count > 1 ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={
            open
              ? t('projects.inbox.repeats.hideAria', { count: entry.count })
              : t('projects.inbox.repeats.showAria', { count: entry.count })
          }
          onClick={() =>
            onExpandedRepeatsChange((current) => {
              const next = new Set(current)

              if (open) next.delete(entry.group)
              else next.add(entry.group)

              return next
            })
          }
          className="mr-4 inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border bg-surface px-2 text-label text-fg-muted hover:bg-surface-hover hover:text-fg md:mr-6"
        >
          <span className="num">
            {t('projects.inbox.repeats.count', { count: entry.count })}
          </span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} />
        </button>
      ) : null}
    </li>
  )
}

/** The list body: the failed and empty states, the grouped rows, the collapsed
 * Later bucket's count and the next page. */
/** The failed read: what went wrong and the retry. */
export function InboxLoadFailed({
  query,
}: {
  query: InboxRows['query']
}): React.ReactElement {
  return (
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
  )
}

/** Nothing in this tab and type: what it would hold, and the way back out. */
export function InboxNothingHere({
  pending,
  tab,
  type,
  typeLabel,
  onClearType,
}: {
  pending: boolean
  tab: InboxTab
  type: InboxType | undefined
  typeLabel: string | undefined
  onClearType: () => void
}): React.ReactElement {
  const body = type
    ? t('projects.inbox.empty.type', { type: typeLabel ?? '' })
    : tab === 'following'
      ? t('projects.inbox.empty.following')
      : tab === 'done-today'
        ? t('projects.inbox.empty.doneToday')
        : t('projects.inbox.empty.needsAction')

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 px-4 py-12 text-center md:px-6"
    >
      <div className="text-prose font-semibold">
        {pending ? t('common.states.loading') : t('projects.inbox.empty.title')}
      </div>
      <div className="max-w-[460px] leading-[19px] text-fg-muted">{body}</div>
      {/* QA3-inbox-2 — the type chips narrow the list, so the state that
          empties it offers the way back. */}
      {type ? (
        <Button size="sm" onClick={onClearType}>
          {t('projects.inbox.clearFilter')}
        </Button>
      ) : null}
    </div>
  )
}

/** The list body: the failed and empty states, the grouped rows, the collapsed
 * Later bucket's count and the next page. */
export function InboxList({
  query,
  rows,
  orderedRowCount,
  onExpandLater,
  sections,
  tab,
  selection,
  onSelectionChange,
  selected,
  expandedRepeats,
  onExpandedRepeatsChange,
  onOpenItem,
  onSelectKey,
  onCollapseLater,
  type,
  typeLabel,
  onClearType,
}: {
  query: InboxRows['query']
  rows: InboxRows
  orderedRowCount: number
  onExpandLater: () => void
  sections: InboxSection[]
  tab: InboxTab
  selection: Set<string>
  onSelectionChange: Dispatch<SetStateAction<Set<string>>>
  selected: WorkItem | undefined
  expandedRepeats: Set<string>
  onExpandedRepeatsChange: Dispatch<SetStateAction<Set<string>>>
  onOpenItem: (item: WorkItem, where?: 'beside' | 'below') => Promise<void>
  onSelectKey: (key: string | null) => void
  onCollapseLater: () => void
  type: InboxType | undefined
  typeLabel: string | undefined
  onClearType: () => void
}): React.ReactElement {
  const { page, items } = rows

  return (
    <div className="min-h-0 flex-1 overflow-auto max-md:pb-20">
      {query.isError && !page ? (
        <InboxLoadFailed query={query} />
      ) : orderedRowCount === 0 && rows.hiddenLater === 0 ? (
        <InboxNothingHere
          pending={query.isPending}
          tab={tab}
          type={type}
          typeLabel={typeLabel}
          onClearType={onClearType}
        />
      ) : (
        <InboxSections
          sections={sections}
          tab={tab}
          visibleCount={rows.visible.length}
          selection={selection}
          onSelectionChange={onSelectionChange}
          selected={selected}
          expandedRepeats={expandedRepeats}
          onExpandedRepeatsChange={onExpandedRepeatsChange}
          onOpenItem={onOpenItem}
          onSelectKey={onSelectKey}
          onCollapseLater={onCollapseLater}
        />
      )}
      {rows.hiddenLater > 0 && !rows.laterExpanded ? (
        <button
          type="button"
          aria-expanded={false}
          onClick={onExpandLater}
          className="flex h-9 w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-4 text-label text-fg-muted hover:text-fg md:px-6"
        >
          {t('projects.inbox.laterItems', { count: rows.hiddenLater })}
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
  )
}
