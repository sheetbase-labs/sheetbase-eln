import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { StocktakeCount } from '#/components/stocktake/stocktake-count'
import {
  StartCountDialog,
  StocktakeList,
} from '#/components/stocktake/stocktake-list'
import { StocktakeSummaryView } from '#/components/stocktake/stocktake-summary'
import { workspaceMemberQueryKeys } from '#/components/projects/project-data'
import { buildStorageTree } from '#/lib/storage-locations'
import type { StorageNode } from '#/lib/storage-locations'
import { stocktakeKeys, summariseItems } from '#/lib/stocktake'
import type { Stocktake, StocktakeItem } from '#/lib/stocktake'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The stocktake screens (`src/components/stocktake/`): the list of counts
 * and the dialog that starts one, the count in progress (scan a code, see
 * what is left to find) and the summary that resolves differences. Counts,
 * items and the storage tree are seeded into the query cache.
 */
const node = (
  level: StorageNode['level'],
  id: string,
  name: string,
  parentId: string | null,
  extra: Partial<StorageNode> = {},
): StorageNode => ({
  level,
  id,
  parentId,
  name,
  code: null,
  position: null,
  unitType: null,
  temperatureMinC: null,
  temperatureMaxC: null,
  rows: null,
  cols: null,
  archivedAt: null,
  held: 0,
  ...extra,
})

const tree = buildStorageTree([
  node('site', 'site-1', 'Main site', null),
  node('room', 'room-1', 'Cold room', 'site-1'),
  node('unit', 'unit-1', 'Freezer F-02', 'room-1', { unitType: 'freezer' }),
  node('shelf', 'shelf-1', 'Shelf 3', 'unit-1'),
  node('box', 'box-1', 'Box B4', 'shelf-1', { rows: 4, cols: 6, code: 'B4' }),
  node('box', 'box-2', 'Box B5', 'shelf-1', { rows: 4, cols: 6, code: 'B5' }),
])

const count = (
  id: string,
  number: number,
  status: Stocktake['status'],
  scopeName: string,
  extra: Partial<Stocktake> = {},
): Stocktake => ({
  id,
  reference: `ST-000${number}`,
  scopeLevel: 'unit',
  scopeId: 'unit-1',
  scopeName,
  scopePath: 'Main site / Cold room',
  status,
  note: null,
  startedBy: 'u-1',
  startedAt: '2026-09-22T09:00:00.000Z',
  completedBy: null,
  completedAt: null,
  cancelledAt: null,
  ...extra,
})

const COUNTS: Stocktake[] = [
  count('st-3', 3, 'open', 'Freezer F-02'),
  count('st-2', 2, 'completed', 'Fridge F-07', {
    completedBy: 'u-1',
    completedAt: '2026-09-15T12:00:00.000Z',
    startedAt: '2026-09-15T09:00:00.000Z',
  }),
  count('st-1', 1, 'cancelled', 'Cold room', {
    cancelledAt: '2026-09-02T10:00:00.000Z',
    startedAt: '2026-09-02T09:00:00.000Z',
  }),
]

const item = (
  id: string,
  identifier: string,
  state: StocktakeItem['state'],
  extra: Partial<StocktakeItem> = {},
): StocktakeItem => ({
  id,
  stocktakeId: 'st-3',
  recordId: `rec-${id}`,
  identifier,
  title: 'Harvest aliquot',
  kind: 'sample',
  expected: true,
  state,
  expectedBoxId: 'box-1',
  expectedPath: 'Freezer F-02 / Shelf 3 / Box B4 / A1',
  foundBoxId: null,
  foundPath: null,
  scannedAt: null,
  resolution: null,
  resolutionNote: null,
  resolvedAt: null,
  ...extra,
})

const ITEMS: StocktakeItem[] = [
  item('i1', 'SMP-2201', 'confirmed', {
    foundBoxId: 'box-1',
    foundPath: 'Freezer F-02 / Shelf 3 / Box B4 / A1',
    scannedAt: '2026-09-22T09:10:00.000Z',
  }),
  item('i2', 'SMP-2202', 'misplaced', {
    foundBoxId: 'box-2',
    foundPath: 'Freezer F-02 / Shelf 3 / Box B5 / C2',
    scannedAt: '2026-09-22T09:12:00.000Z',
  }),
  item('i3', 'SMP-2203', 'missing'),
  item('i4', 'SMP-2290', 'unexpected', {
    expected: false,
    expectedBoxId: null,
    expectedPath: null,
    foundBoxId: 'box-1',
    foundPath: 'Freezer F-02 / Shelf 3 / Box B4 / D6',
    scannedAt: '2026-09-22T09:15:00.000Z',
  }),
  item('i5', 'SMP-2204', 'expected'),
]

const client = screenQueryClient({
  data: [
    { key: stocktakeKeys.list, value: COUNTS },
    {
      key: [...stocktakeKeys.list, 'summaries'],
      value: new Map([
        ['st-3', summariseItems(ITEMS)],
        ['st-2', summariseItems(ITEMS.slice(0, 1))],
      ]),
    },
    {
      key: workspaceMemberQueryKeys.identities,
      value: new Map([['u-1', 'Dana Whitfield']]),
    },
    { key: stocktakeKeys.tree, value: tree },
    { key: stocktakeKeys.detail('st-3'), value: COUNTS[0] },
    { key: stocktakeKeys.items('st-3'), value: ITEMS },
  ],
})

const emptyClient = screenQueryClient({
  data: [
    { key: stocktakeKeys.list, value: [] },
    { key: [...stocktakeKeys.list, 'summaries'], value: new Map() },
    { key: workspaceMemberQueryKeys.identities, value: new Map() },
  ],
})

const meta = {
  title: 'Stocktake/Screens',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/stocktake', [
          '/stocktake/$stocktakeId',
          '/samples/$sampleId',
          '/r/$identifier',
        ]),
        path: '/stocktake',
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const noop = () => {}

/** The counts so far: open, completed with its result, and called off. */
export const List: Story = {
  render: () => (
    <div className="flex h-[420px] w-[1000px] max-w-full flex-col">
      <StocktakeList canWrite />
    </div>
  ),
}

/** No counts yet. */
export const ListEmpty: Story = {
  render: () => (
    <QueryClientProvider client={emptyClient}>
      <div className="flex h-[360px] w-[1000px] max-w-full flex-col">
        <StocktakeList canWrite />
      </div>
    </QueryClientProvider>
  ),
}

/** Starting a count: pick the place to count and add a note. */
export const StartDialog: Story = {
  render: () => (
    <StartCountDialog open onOpenChange={noop} canStart onStarted={noop} />
  ),
}

/** The count in progress: scan a code, what is found and what is left. */
export const Count: Story = {
  render: () => (
    <div className="flex h-[640px] w-[1000px] max-w-full flex-col">
      <StocktakeCount stocktakeId="st-3" canWrite />
    </div>
  ),
}

/** A count that is not visible to this person. */
export const CountNotFound: Story = {
  render: () => {
    const missing = screenQueryClient({
      data: [
        { key: stocktakeKeys.detail('st-9'), value: null },
        { key: stocktakeKeys.items('st-9'), value: [] },
        { key: stocktakeKeys.tree, value: tree },
      ],
    })

    return (
      <QueryClientProvider client={missing}>
        <div className="flex h-[360px] w-[1000px] max-w-full flex-col">
          <StocktakeCount stocktakeId="st-9" canWrite />
        </div>
      </QueryClientProvider>
    )
  },
}

/** The summary of a finished count: differences waiting for a decision. */
export const Summary: Story = {
  render: () => (
    <div className="flex h-[640px] w-[1000px] max-w-full flex-col">
      <StocktakeSummaryView
        stocktake={{
          ...COUNTS[0],
          status: 'completed',
          completedBy: 'u-1',
          completedAt: '2026-09-22T11:00:00.000Z',
        }}
        items={ITEMS.filter((entry) => entry.state !== 'expected')}
        loading={false}
        canWrite
      />
    </div>
  ),
}

/** A count called off keeps its summary read-only. */
export const SummaryCalledOff: Story = {
  render: () => (
    <div className="flex h-[480px] w-[1000px] max-w-full flex-col">
      <StocktakeSummaryView
        stocktake={COUNTS[2]}
        items={ITEMS}
        loading={false}
        canWrite
      />
    </div>
  ),
}
