import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordResults } from '#/components/record/record-results'
import type { RecordResultRow } from '#/lib/record-results'
import { recordResultsQueryKey } from '#/lib/record-results'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The Results tab of a record: every dataset row linked to it, one table per
 * measurement table, live or kept in a snapshot.
 */
const meta = {
  title: 'Records/Results',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/samples', ['/samples/$sampleId']),
        path: '/samples',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const RECORD = 'rec-1'

const row = (
  rowId: string,
  od: number,
  extra: Partial<RecordResultRow> = {},
): RecordResultRow => ({
  rowId,
  datasetId: 'ds-1',
  datasetDisplayId: 'DS-0311',
  datasetName: 'Growth curve run 4',
  tableId: 't-1',
  tableKey: 'growth_curve',
  tableName: 'Growth curve',
  tableVersion: 1,
  source: 'live',
  snapshotId: null,
  snapshotLabel: null,
  status: 'recorded',
  recordedAt: '2026-11-20T09:12:00Z',
  values: [
    {
      fieldId: 'f-1',
      key: 'sample',
      label: 'Sample',
      type: 'reference',
      unit: null,
      linksHere: true,
      value: RECORD,
    },
    {
      fieldId: 'f-2',
      key: 'od',
      label: 'OD600',
      type: 'decimal',
      unit: 'AU',
      linksHere: false,
      value: od,
    },
  ],
  ...extra,
})

const filled = screenQueryClient({
  data: [
    {
      key: recordResultsQueryKey(RECORD, false),
      value: {
        total: 2,
        rows: [row('r-1', 0.42), row('r-2', 0.91)],
      },
    },
  ],
})

/** Rows linked to the record, in the table they follow. */
export const WithResults: Story = {
  render: () => (
    <QueryClientProvider client={filled}>
      <RecordResults recordId={RECORD} />
    </QueryClientProvider>
  ),
}

const empty = screenQueryClient({
  data: [
    {
      key: recordResultsQueryKey(RECORD, false),
      value: { total: 0, rows: [] },
    },
  ],
})

/** Nothing links to the record yet. */
export const NoResults: Story = {
  render: () => (
    <QueryClientProvider client={empty}>
      <RecordResults recordId={RECORD} variant="panel" />
    </QueryClientProvider>
  ),
}
