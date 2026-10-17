import * as React from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '#/components/v3/ui/button'
import { ListHeader } from '#/components/v3/inventory/list'
import { cn } from '#/lib/utils'
import {
  ComparisonErrorState,
  ComparisonLoadingRows,
  ComparisonRestrictedNotice,
} from '#/components/component-compare/surface'
import type {
  ComparisonColumnProps,
  ComparisonPair,
} from '#/components/component-compare/types'

/**
 * Pair — the header of a list screen.
 *
 * Ours: `ListHeader` (`src/components/v3/inventory/list.tsx`), which eight list
 * screens compose. It gained one prop in this change — `subtitle` — because the
 * inbox header carries a line beside its title that the eight did not, and the
 * only other place to put it was the `<h1>`, which would have made the sentence
 * part of the heading's accessible name.
 *
 * Theirs: the same header as the inbox composed it by hand. Its class strings
 * matched `ListHeader`'s character for character, including the tab-strip rail,
 * and it also carried the two behaviours the pattern is defended for: the row
 * wraps (at 390 the two actions measured 408 and pushed "Mark all seen" out of
 * the viewport with no ancestor able to scroll to it) and the tab counts say
 * `—` while the counts are unknown.
 *
 * The pair renders the inbox header, which is the harder of the two hand-rolls
 * — subtitle, two actions and a roving-focus tablist. The experiments header,
 * which has a count and a full-width action instead, is the same band and is
 * covered by the `v3 kit/List header` story; both were migrated in this change.
 */

const TAB_LIST = [
  ['needs-action', 'Needs action'],
  ['following', 'Following'],
  ['done-today', 'Done today'],
] as const

/** The tablist either header renders: roving focus, arrow keys, counts. */
function useTabList(countsKnown: boolean, count: number) {
  const [tab, setTab] = React.useState('needs-action')
  const tabsRef = React.useRef<(HTMLButtonElement | null)[]>([])
  const onTabKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = TAB_LIST.findIndex(([key]) => key === tab)
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % TAB_LIST.length
        : (index - 1 + TAB_LIST.length) % TAB_LIST.length
    setTab(TAB_LIST[next][0])
    tabsRef.current[next]?.focus()
  }
  const tabs = (
    <div
      role="tablist"
      aria-label="Inbox"
      onKeyDown={onTabKeys}
      className="flex gap-5 overflow-x-auto [scrollbar-width:none]"
    >
      {TAB_LIST.map(([key, label], index) => (
        <button
          key={key}
          ref={(el) => {
            tabsRef.current[index] = el
          }}
          type="button"
          role="tab"
          aria-selected={tab === key}
          tabIndex={tab === key ? 0 : -1}
          onClick={() => setTab(key)}
          className={cn(
            'inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-0 border-b-2 border-transparent bg-transparent px-0.5 text-body font-medium text-fg-muted hover:text-fg max-md:h-11',
            tab === key && 'border-link text-fg',
          )}
        >
          {label}
          <span className="text-label font-normal text-fg-muted">
            {countsKnown ? count : '—'}
          </span>
        </button>
      ))}
    </div>
  )
  return tabs
}

function OurListHeaderColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const tabs = useTabList(
    scenario.state === 'ready',
    scenario.fixture.rows.length,
  )

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col" data-comparison-list="ours">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      <ListHeader
        title="Inbox"
        subtitle="Everything waiting on you, across projects"
        actions={
          <>
            <Button nativeButton={false} render={<Link to="/" />}>
              Notification settings
            </Button>
            <Button disabled={rows.length === 0}>Mark all seen</Button>
          </>
        }
        tabs={tabs}
      />
    </div>
  )
}

function HandRolledListHeaderColumn({ scenario }: ComparisonColumnProps) {
  const rows = scenario.fixture.rows
  const countsKnown = scenario.state === 'ready'
  const tabs = useTabList(countsKnown, rows.length)

  if (scenario.state === 'loading') return <ComparisonLoadingRows />
  if (scenario.state === 'error') {
    return <ComparisonErrorState onRetry={scenario.onRetry} />
  }

  return (
    <div className="flex flex-col" data-comparison-list="theirs">
      {scenario.state === 'restricted' ? <ComparisonRestrictedNotice /> : null}
      {/* inbox.tsx's header, as it shipped. */}
      <header className="flex flex-col gap-1 border-b border-border px-4 pt-4 md:px-6">
        <div className="flex items-center gap-2 max-md:flex-wrap">
          <h1 className="text-title">Inbox</h1>
          <span className="ml-1 text-body text-fg-muted max-md:hidden">
            Everything waiting on you, across projects
          </span>
          <span className="flex-1 max-md:hidden" />
          <Button>Notification settings</Button>
          <Button disabled={rows.length === 0}>Mark all seen</Button>
        </div>
        <div className="mt-1 [&>div]:mt-0">{tabs}</div>
      </header>
    </div>
  )
}

export const listHeaderPair: ComparisonPair = {
  id: 'list-header',
  title: 'List screen header',
  job: 'Name a list, count it, and put its actions and views on one header',
  controls: [],
  ours: {
    id: 'ours',
    label: 'Ours — v3 ListHeader (one band, eight screens)',
    source: 'src/components/v3/inventory/list.tsx',
    Column: OurListHeaderColumn,
  },
  theirs: {
    id: 'theirs',
    label: 'Theirs — the inbox header the change deleted',
    source: 'src/routes/inbox.tsx (as shipped)',
    Column: HandRolledListHeaderColumn,
  },
}
