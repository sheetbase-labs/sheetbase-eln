import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { Dot, Status } from '#/components/v3/ui/status'
import type { Tone } from '#/components/v3/ui/status'
import {
  Inspector,
  InspectorSection,
  DescriptionList,
} from '#/components/v3/ui/layout'
import { Kbd } from '#/components/v3/ui/kbd'
import { CapabilityGap } from '#/components/v3/ui/capability-gap'
import { cn } from '#/lib/utils'
import { capabilityRoadmap } from '#/lib/capabilities'
import { groupWorkItems, useWorkItems } from '#/lib/work-items/data'
import type { WorkItem, WorkItemKind } from '#/lib/work-items/data'

type InboxTab = 'needs-action' | 'following' | 'done-today'
type InboxType = 'reviews' | 'runs' | 'following'

const tabs: [InboxTab, string][] = [
  ['needs-action', 'Needs action'],
  ['following', 'Following'],
  ['done-today', 'Done today'],
]
const types: [InboxType, string, Tone, WorkItemKind][] = [
  ['reviews', 'Reviews', 'review', 'review_requested'],
  ['runs', 'Runs', 'analysis', 'run_failed'],
  ['following', 'Following', 'stored', 'following'],
]

/** UI port (roadmap-4/ui-app3): the Inbox, wired to `my_work_items`. Data
 * issues, signatures and materials item kinds arrive with their capabilities. */
export const Route = createFileRoute('/inbox')({
  component: Inbox,
})

function kindToType(kind: WorkItemKind): InboxType {
  if (kind === 'review_requested') return 'reviews'
  if (kind === 'run_failed') return 'runs'
  return 'following'
}

function toneFor(kind: WorkItemKind): Tone {
  if (kind === 'review_requested') return 'review'
  if (kind === 'run_failed') return 'bad'
  return 'stored'
}

function labelFor(kind: WorkItemKind, state: string): string {
  if (state === 'overdue') return 'Overdue'
  if (kind === 'review_requested') return 'Review'
  if (kind === 'run_failed') return 'Failed'
  return 'Following'
}

function itemTab(item: WorkItem): InboxTab {
  if (item.state === 'following' || item.kind === 'following')
    return 'following'
  if (item.state === 'done_today') return 'done-today'
  return 'needs-action'
}

function itemLink(item: WorkItem) {
  if (item.kind === 'run_failed') return { to: '/pipelines' as const }
  if (item.recordId)
    return {
      to: '/records/$recordId' as const,
      params: { recordId: item.recordId },
    }
  return { to: '/inbox' as const }
}

function Inbox() {
  const { auth } = Route.useRouteContext()
  const role = auth?.workspace?.role
  const admin = role === 'owner' || role === 'admin'
  const query = useWorkItems()
  const items = query.data ?? []
  const [tab, setTab] = useState<InboxTab>('needs-action')
  const [type, setType] = useState<InboxType | undefined>(undefined)
  const [later, setLater] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const groups = useMemo(() => groupWorkItems(items), [items])
  const inTab = items.filter((i) => itemTab(i) === tab)
  const visible = inTab.filter((i) => !type || kindToType(i.kind) === type)
  const shown = visible.filter((i) => later || !groups.later.includes(i))
  const hiddenLater = groups.later.filter(
    (i) => itemTab(i) === tab && (!type || kindToType(i.kind) === type),
  ).length
  const selected =
    shown.find((i) => (i.recordId ?? i.identifier) === selectedKey) ?? shown[0]
  const tabCount = (t: InboxTab) =>
    items.filter((i) => itemTab(i) === t && !groups.later.includes(i)).length
  const typeCount = (t: InboxType) =>
    inTab.filter(
      (i) => kindToType(i.kind) === t && (later || !groups.later.includes(i)),
    ).length

  const sections: [string | null, WorkItem[]][] =
    tab === 'needs-action'
      ? [
          ['Today', groups.today],
          ['Next 7 days', groups.nextSevenDays],
          ['Later', later ? groups.later : []],
        ]
      : [[null, shown]]

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-1 border-b border-border px-4 pt-4 md:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-title">Inbox</h1>
            <span className="ml-1 text-body text-fg-muted max-md:hidden">
              Everything waiting on you, across projects
            </span>
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
          <span className="shrink-0 whitespace-nowrap text-label text-fg-muted max-lg:hidden">
            Sorted by due date · <Kbd>J</Kbd>/<Kbd>K</Kbd> to move
          </span>
        </div>

        <div className="px-4 pt-2 md:px-6">
          <CapabilityGap
            variant="inline"
            title="Data-issue, material and signature items aren’t in the Inbox yet"
            will="Dataset errors, material expiries and signature requests will appear here alongside reviews and failed runs."
            roadmap={capabilityRoadmap.inboxKinds}
            admin={admin}
            instead={[
              { label: 'Datasets with errors', link: { to: '/datasets' } },
              { label: 'Materials', link: { to: '/materials' } },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {shown.length === 0 && hiddenLater === 0 ? (
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
                      const key = i.recordId ?? i.identifier ?? i.title
                      return (
                        <button
                          key={key}
                          type="button"
                          role="listitem"
                          aria-current={selected === i ? true : undefined}
                          onClick={() => setSelectedKey(key)}
                          className={cn(
                            'grid min-h-11 w-full cursor-pointer grid-cols-[104px_minmax(0,1fr)_110px] items-center gap-3 border-0 border-b border-border-subtle bg-transparent px-4 py-1.5 text-left hover:bg-row-hover md:px-6',
                            selected === i && 'bg-selection hover:bg-selection',
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
                            </span>
                            <span className="block truncate text-label text-fg-muted">
                              {i.reason}
                            </span>
                          </span>
                          <span className="text-right text-label text-fg-muted">
                            {i.dueAt ? i.dueAt.slice(0, 10) : '—'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
          {shown.length === 0 && hiddenLater > 0 && !later ? (
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
        <Inspector aria-label="Item details" className="w-[320px] gap-0 p-0">
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
