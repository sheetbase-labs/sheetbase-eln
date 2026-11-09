import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { liveFeedQueryKeys } from '#/components/instruments/live-feeds-data'
import type { FeedRow } from '#/components/instruments/live-feeds-data'
import { StorageReadingsSection } from '#/components/storage/storage-readings'
import type { StorageNode } from '#/lib/storage-locations'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'

/**
 * Readings kept for a freezer or room (`storage-readings.tsx`): the latest
 * value against its limits, and a way to log one by hand.
 */
const meta = {
  title: 'Storage/Readings',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/storage'),
        path: '/storage',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const freezer: StorageNode = {
  level: 'unit',
  id: 'unit-1',
  parentId: null,
  name: 'Freezer F-12',
  code: 'F-12',
  position: null,
  unitType: null,
  temperatureMinC: -85,
  temperatureMaxC: -75,
  rows: null,
  cols: null,
  archivedAt: null,
  held: 0,
}

const feed = (state: FeedRow['limitState'], value: number): FeedRow => ({
  id: 'feed-1',
  ownerId: freezer.id,
  instrumentId: null,
  storageUnitId: freezer.id,
  storageRoomId: null,
  outOfRangeSince: state === 'ok' ? null : new Date().toISOString(),
  name: 'Temperature',
  unit: '°C',
  lowLimit: -85,
  highLimit: -75,
  limitState: state,
  lastValue: value,
  lastAt: new Date(Date.now() - 60_000).toISOString(),
  readingCount: 1440,
})

function inside(feeds: FeedRow[]) {
  const client = screenQueryClient({
    data: [{ key: liveFeedQueryKeys.feeds(freezer.id), value: feeds }],
  })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <div className="w-[760px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

export const InRange: Story = {
  render: () => <StorageReadingsSection node={freezer} canLog canSetLimits />,
  decorators: [withApiReads('pending'), inside([feed('ok', -80.2)])],
}

export const TooWarm: Story = {
  render: () => <StorageReadingsSection node={freezer} canLog canSetLimits />,
  decorators: [withApiReads('pending'), inside([feed('high', -68.4)])],
}

export const NoReadingsYet: Story = {
  render: () => <StorageReadingsSection node={freezer} canLog canSetLimits />,
  decorators: [withApiReads('pending'), inside([])],
}
