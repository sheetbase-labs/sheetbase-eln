import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Tabs } from '#/components/v3/ui/tabs'

/**
 * The tab family in `#/components/v3/ui/tabs`: one contract, two modes, three
 * variants. This story belongs to the survivor of the reconciliation — the two
 * `SearchTabs`, the unused `RouteTabs`, `LinkTabs` and `SegmentLinks` were
 * deleted with it (the module comment says what each one was).
 *
 * The two modes are the two jobs:
 *
 * - **State** — the tabs change what is shown in place. A tablist: one tab
 *   stop, ArrowLeft/ArrowRight, Home/End, `aria-selected`, activation on focus.
 * - **URL** — each tab is its own URL. A nav of links: the current one carries
 *   `aria-current="page"` and no `aria-selected`, because a link is not a tab.
 *
 * The URL story is a real `Link` rendered without a router of its own; see the
 * note on that story for what Storybook can and cannot show.
 */
const meta = {
  title: 'UI/Tab family',
  component: Tabs,
  args: {
    label: 'Views',
    mode: 'state' as const,
    value: 'all',
    onValueChange: () => {},
    items: [
      { key: 'all', label: 'All', count: 24 },
      { key: 'mine', label: 'Mine', count: 3 },
      { key: 'issues', label: 'Issues', count: 0 },
    ],
  },
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

/** The list screens' section row: an underline strip with counts. */
export const StateStrip: Story = {
  render: () => (
    <Strip>
      <Tabs
        mode="state"
        label="Dataset lists"
        value="all"
        onValueChange={() => {}}
        items={[
          { key: 'all', label: 'All', count: 24 },
          { key: 'mine', label: 'Mine', count: 3 },
          { key: 'issues', label: 'Issues' },
        ]}
      />
    </Strip>
  ),
}

/** The toolbar control: a compact "one of N" segment. Click or arrow through it. */
export const StateSegment: Story = {
  render: () => <SegmentDemo />,
}

/** The phone chip row. */
export const StateChips: Story = {
  render: () => <ChipDemo />,
}

/** The same strip with labels long enough to force its rail to scroll. */
export const OverflowAt390: Story = {
  render: () => (
    <div className="w-[390px] border border-border p-2">
      <Tabs
        mode="state"
        label="Views at 390 pixels"
        value="longest"
        onValueChange={() => {}}
        items={[
          { key: 'latest', label: 'Latest revisions', count: 118 },
          { key: 'awaiting', label: 'Awaiting my review', count: 4 },
          { key: 'longest', label: 'Changed by anyone else', count: 96 },
        ]}
      />
    </div>
  ),
}

/**
 * URL mode: a list filtered by `?tab=`, where the key names the current tab.
 *
 * Rendered without a router: Storybook supplies its own routing context, and a
 * real `Link` needs the app's router to resolve a `params`-bearing path. The
 * strip is shown with `value` naming the current tab — the shape all ten list
 * screens use — so the link targets are the app's own paths and clicking does
 * nothing here. The router-decides flavour (one path per tab, no key) is
 * exercised where it is real: the record-detail layouts in the app, and
 * `tabs.test.tsx` asserts the options the strip hands the router for it.
 */
export const UrlSearchParamTabs: Story = {
  render: () => (
    <Strip>
      <Tabs
        mode="url"
        label="Dataset lists"
        value="mine"
        items={[
          {
            key: 'all',
            label: 'All',
            count: 24,
            link: { to: '/datasets', search: { tab: undefined } },
          },
          {
            key: 'mine',
            label: 'Mine',
            count: 3,
            link: { to: '/datasets', search: { tab: 'mine' } },
          },
          {
            key: 'issues',
            label: 'Issues',
            count: 0,
            link: { to: '/datasets', search: { tab: 'issues' } },
          },
        ]}
      />
      <p className="py-3 text-body text-fg-muted">
        Mine is current: a nav of links, the current one carrying{' '}
        <span className="mono">aria-current=&quot;page&quot;</span> and no{' '}
        <span className="mono">aria-selected</span>.
      </p>
    </Strip>
  ),
}

function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-surface px-4 pt-3">
      <h1 className="text-title">Datasets</h1>
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
        {children}
      </div>
    </div>
  )
}

function SegmentDemo() {
  const [view, setView] = useState('week')
  return (
    <div className="flex items-center gap-2">
      <span className="text-label text-fg-muted">View</span>
      <Tabs
        mode="state"
        variant="segment"
        label="Schedule view"
        value={view}
        onValueChange={setView}
        items={[
          { key: 'day', label: 'Day' },
          { key: 'week', label: 'Week' },
        ]}
      />
    </div>
  )
}

function ChipDemo() {
  const [section, setSection] = useState('projects')
  return (
    <div className="w-[390px]">
      <Tabs
        mode="state"
        variant="chip"
        label="Portal sections"
        value={section}
        onValueChange={setSection}
        items={[
          { key: 'projects', label: 'Projects' },
          { key: 'reports', label: 'Reports' },
          { key: 'messages', label: 'Messages' },
        ]}
      />
    </div>
  )
}
