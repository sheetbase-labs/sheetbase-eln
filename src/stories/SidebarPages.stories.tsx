import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SidebarPagesPanel } from '#/components/settings/sidebar-pages-panel'
import { sidebarPagesQueryKey } from '#/lib/sidebar-pages'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Settings > Lab setup > Sidebar: the pages the lab lists in everyone's
 * sidebar. Projects and Experiments are always shown. Every read is seeded,
 * so nothing is fetched.
 */
const meta = {
  title: 'Settings/Lab setup/Sidebar',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/settings/lab/sidebar'),
        path: '/settings/lab/sidebar',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const hiddenClient = screenQueryClient({
  data: [
    {
      key: sidebarPagesQueryKey('ws-1'),
      value: ['shipments', 'incidents', 'pipelines'],
    },
  ],
})

/** A small lab that does not ship samples, log incidents or run pipelines. */
export const SomePagesHidden: Story = {
  render: () => (
    <QueryClientProvider client={hiddenClient}>
      <div className="w-[900px] max-w-full">
        <SidebarPagesPanel workspaceId="ws-1" canManage />
      </div>
    </QueryClientProvider>
  ),
}

const viewClient = screenQueryClient({
  data: [{ key: sidebarPagesQueryKey('ws-1'), value: [] }],
})

/** Someone who can see Lab setup but not change the lab's sidebar. */
export const ViewOnly: Story = {
  render: () => (
    <QueryClientProvider client={viewClient}>
      <div className="w-[900px] max-w-full">
        <SidebarPagesPanel workspaceId="ws-1" canManage={false} />
      </div>
    </QueryClientProvider>
  ),
}
