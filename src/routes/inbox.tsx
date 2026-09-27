import { useCallback, useMemo, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'

import { useShell } from '#/components/shell'
import { Icon } from '#/components/icons'
import { Button, Empty, EmptyDescription, EmptyTitle } from '#/components/ui'
import {
  useRegisterShortcuts,
  useShortcutScope,
} from '#/components/shortcuts/shortcut-provider'
import { recordPath } from '#/lib/navigation'
import {
  countByKind,
  groupWorkItems,
  useWorkItems,
} from '#/lib/work-items/data'
import type { WorkItem, WorkItemKind } from '#/lib/work-items/data'

export const Route = createFileRoute('/inbox')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: InboxRoute,
})

const KIND_LABEL: Record<WorkItemKind, string> = {
  review_requested: 'Review',
  run_failed: 'Run',
  following: 'Following',
}

const KIND_FILTER_LABEL: Record<WorkItemKind, string> = {
  review_requested: 'Reviews',
  run_failed: 'Runs',
  following: 'Following',
}

type InboxTab = 'needs_action' | 'following' | 'done_today'

const TABS: ReadonlyArray<{ id: InboxTab; label: string }> = [
  { id: 'needs_action', label: 'Needs action' },
  { id: 'following', label: 'Following' },
  { id: 'done_today', label: 'Done today' },
]

function itemKey(item: WorkItem): string {
  return `${item.kind}:${item.recordId ?? item.identifier ?? item.title}`
}

/**
 * WORK-02.3 — the Inbox: everything waiting on the caller across projects,
 * with type counts, due-date groups and J/K navigation. Empty state matches
 * InboxEmpty.
 */
function InboxRoute() {
  const { context } = Route.useRouteContext()
  const itemsQuery = useWorkItems()
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const [tab, setTab] = useState<InboxTab>('needs_action')
  const [kindFilter, setKindFilter] = useState<WorkItemKind | 'all'>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const counts = countByKind(items)
  const groups = useMemo(() => groupWorkItems(items), [items])

  const visible = useMemo(() => {
    const source =
      tab === 'following'
        ? groups.following
        : tab === 'done_today'
          ? []
          : [...groups.today, ...groups.nextSevenDays, ...groups.later]
    return kindFilter === 'all'
      ? source
      : source.filter((item) => item.kind === kindFilter)
  }, [tab, kindFilter, groups])

  const selected = useMemo(() => {
    if (visible.length === 0) return null
    return visible.find((item) => itemKey(item) === selectedKey) ?? visible[0]
  }, [visible, selectedKey])

  const move = useCallback(
    (delta: number) => {
      if (visible.length === 0) return
      const currentIndex = selected ? visible.indexOf(selected) : -1
      const nextIndex = Math.min(
        visible.length - 1,
        Math.max(0, currentIndex + delta),
      )
      const next = visible[nextIndex]
      setSelectedKey(itemKey(next))
    },
    [visible, selected],
  )

  useShortcutScope('list')
  const listShortcuts = useMemo(
    () => [
      {
        id: 'inbox-next',
        scope: 'list' as const,
        keys: ['j'],
        description: 'Next item',
        handler: () => move(1),
      },
      {
        id: 'inbox-prev',
        scope: 'list' as const,
        keys: ['k'],
        description: 'Previous item',
        handler: () => move(-1),
      },
    ],
    [move],
  )
  useRegisterShortcuts(listShortcuts)

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: {
        name: context.user.name,
        email: context.user.email,
        role: context.workspace?.role,
      },
    },
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Inbox' }],
    title: 'Inbox',
    status: 'Everything waiting on you, across projects',
    actions: (
      <Button asChild variant="secondary" size="md">
        <Link to="/settings">Notification settings</Link>
      </Button>
    ),
    inspector: selected ? <InboxInspector item={selected} /> : undefined,
    inspectorLabel: 'Work item',
  })

  const needsActionCount = counts.review_requested + counts.run_failed

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Inbox tabs"
        className="flex items-center gap-5 border-b border-border text-sm"
      >
        {TABS.map((entry) => {
          const count =
            entry.id === 'needs_action'
              ? needsActionCount
              : entry.id === 'following'
                ? counts.following
                : 0
          const active = tab === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(entry.id)}
              className={
                active
                  ? '-mb-px border-b-2 border-primary pb-2 font-medium text-foreground'
                  : '-mb-px border-b-2 border-transparent pb-2 text-muted-foreground hover:text-foreground'
              }
            >
              {entry.label}
              <span className="ml-1.5 text-caption text-muted-foreground">
                {count}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterButton
          active={kindFilter === 'all'}
          onClick={() => setKindFilter('all')}
        >
          All types
        </FilterButton>
        {(Object.keys(KIND_LABEL) as WorkItemKind[]).map((kind) => (
          <FilterButton
            key={kind}
            active={kindFilter === kind}
            onClick={() => setKindFilter(kind)}
          >
            {KIND_FILTER_LABEL[kind]} {counts[kind]}
          </FilterButton>
        ))}
      </div>

      {itemsQuery.isLoading ? (
        <p className="text-body text-muted-foreground">Loading…</p>
      ) : visible.length === 0 ? (
        <Empty>
          <EmptyTitle>Nothing needs you right now</EmptyTitle>
          <EmptyDescription>
            Reviews, signature requests, data issues and runs assigned to you
            will appear here.
          </EmptyDescription>
        </Empty>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {visible.map((item) => (
            <li key={itemKey(item)}>
              <InboxRow
                item={item}
                selected={
                  selected !== null && itemKey(selected) === itemKey(item)
                }
                onSelect={() => setSelectedKey(itemKey(item))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? 'inline-flex h-6 items-center rounded-md border border-border-strong bg-accent px-2 text-caption font-medium text-foreground'
          : 'inline-flex h-6 items-center rounded-md border border-border bg-card px-2 text-caption text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </button>
  )
}

function InboxRow({
  item,
  selected,
  onSelect,
}: {
  item: WorkItem
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div
      data-selected={selected ? 'true' : 'false'}
      className={
        selected
          ? 'flex items-center gap-3 bg-accent/60 px-3 py-2'
          : 'flex items-center gap-3 px-3 py-2 hover:bg-accent/40'
      }
    >
      <span className="w-16 shrink-0 text-caption text-muted-foreground">
        {KIND_LABEL[item.kind]}
      </span>
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-body text-foreground">
          {item.title}
        </span>
        <span className="block truncate text-caption text-muted-foreground">
          {item.reason}
          {item.identifier ? ` · ${item.identifier}` : ''}
        </span>
      </button>
      {item.recordId ? (
        <Link
          to={recordPath(item.recordId)}
          className="shrink-0 text-caption text-primary hover:underline"
        >
          Open
        </Link>
      ) : null}
    </div>
  )
}

function InboxInspector({ item }: { item: WorkItem }) {
  return (
    <div className="flex flex-col gap-3 p-4 text-body">
      <div>
        <p className="text-caption text-muted-foreground">
          {KIND_LABEL[item.kind]}
        </p>
        <p className="font-medium text-foreground">{item.title}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-caption">
        {item.identifier ? (
          <>
            <dt className="text-muted-foreground">Identifier</dt>
            <dd className="text-foreground">{item.identifier}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Reason</dt>
        <dd className="text-foreground">{item.reason}</dd>
        <dt className="text-muted-foreground">Due</dt>
        <dd className="text-foreground">
          {item.dueAt
            ? new Date(item.dueAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
              })
            : '—'}
        </dd>
        <dt className="text-muted-foreground">State</dt>
        <dd className="text-foreground">{item.state.replace('_', ' ')}</dd>
      </dl>
      {item.recordId ? (
        <Button asChild variant="primary" size="sm">
          <Link to={recordPath(item.recordId)}>
            <Icon name="chevronRight" size={12} /> Open
          </Link>
        </Button>
      ) : null}
    </div>
  )
}
