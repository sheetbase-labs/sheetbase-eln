import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

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
 * The URL stories mount a memory router: a real `Link` needs one above it, and
 * a bare `<a>` would not show what the router does with the current tab.
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

/** URL mode: a list filtered by `?tab=`, where the key names the current tab. */
export const UrlSearchParamTabs: Story = {
  render: () => <SearchParamUrlDemo />,
}

/** URL mode: one path per tab, where the router decides which is current. */
export const UrlPathTabs: Story = {
  render: () => <PathUrlDemo />,
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

// --- URL mode, on a memory router -----------------------------------------

const rootRoute = createRootRoute({ component: () => <Outlet /> })

const datasetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/datasets',
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
  }),
  component: DatasetListPage,
})

const modelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/models/$modelId',
  component: () => <Outlet />,
})

const modelFieldsRoute = createRoute({
  getParentRoute: () => modelRoute,
  path: 'fields',
  component: ModelSectionPage,
})

const modelVersionsRoute = createRoute({
  getParentRoute: () => modelRoute,
  path: 'versions',
  component: ModelSectionPage,
})

function DatasetListPage() {
  const { tab } = datasetsRoute.useSearch()
  const current = tab ?? 'all'
  return (
    <Strip>
      <Tabs
        mode="url"
        label="Dataset lists"
        value={current}
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
        Showing the <span className="mono">{current}</span> tab — click a tab,
        the URL follows it.
      </p>
    </Strip>
  )
}

function ModelSectionPage() {
  return (
    <div className="border-b border-border px-4 pb-2">
      <Tabs
        mode="url"
        label="Model sections"
        items={[
          {
            key: 'fields',
            label: 'Fields',
            count: 12,
            link: {
              to: '/models/$modelId/fields',
              params: { modelId: 'RM-1' },
            },
          },
          {
            key: 'versions',
            label: 'Versions',
            count: 4,
            link: {
              to: '/models/$modelId/versions',
              params: { modelId: 'RM-1' },
            },
          },
        ]}
      />
      <p className="py-3 text-body text-fg-muted">
        Each tab is its own path, so the strip names no key: the router marks
        the tab you are on.
      </p>
    </div>
  )
}

const routeTree = rootRoute.addChildren([
  datasetsRoute,
  modelRoute.addChildren([modelFieldsRoute, modelVersionsRoute]),
])

function SearchParamUrlDemo() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/datasets?tab=mine'] }),
  })
  return <RouterProvider router={router} />
}

function PathUrlDemo() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/models/RM-1/versions'] }),
  })
  return <RouterProvider router={router} />
}
