import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ScientificWorkbookProvider } from '#/components/notebook/scientific-workbook-provider'
import { ScientificSheetBlock } from '#/components/sheet/scientific-sheet-block'
import type { NotebookBlock } from '#/lib/notebook-data'
import { scientificQueryKeys } from '#/lib/scientific-sheet-data'
import type {
  ScientificRowWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'

/**
 * The `scientific_sheet` notebook block. It reads its table, its rows and its
 * formulas by id on mount, so the stories seed those three reads with a small
 * static table: the loaded grid, the read-only grid a frozen revision shows,
 * and — with the reads left pending or refused — the block's own loading and
 * error surfaces.
 *
 * The block must sit inside the notebook's workbook owner — the provider the
 * document mounts once — because calculation ownership is what stops two
 * blocks from calculating the same table independently.
 */
const TABLE_ID = '0198d970-e266-4000-8000-000000000030'
const WELL_COLUMN = '0198d970-e266-4000-8000-0000000000c1'
const OD_COLUMN = '0198d970-e266-4000-8000-0000000000c2'

const block: NotebookBlock = {
  id: '0198d970-e266-4000-8000-0000000000b1',
  recordId: '0198d970-e266-4000-8000-0000000000a1',
  type: 'scientific_sheet',
  payload: { tableId: TABLE_ID, title: 'Plate readings' },
  payloadSchemaVersion: 1,
  order: 3,
  version: 2,
}

const table: ScientificTableWire = {
  id: TABLE_ID,
  created_at: '2026-10-01T09:00:00Z',
  resource_name: 'scientific_sheet_plate_readings',
  name: 'Plate readings',
  schema_version: 2,
  lifecycle: 'active',
  columns: [
    {
      id: WELL_COLUMN,
      field_name: 'well',
      label: 'Well',
      display_order: 0,
      logical_type: 'text',
      nullable: false,
      unit: null,
      validation: {},
      width: 140,
      options: [],
    },
    {
      id: OD_COLUMN,
      field_name: 'od600',
      label: 'OD₆₀₀',
      display_order: 1,
      logical_type: 'decimal',
      nullable: true,
      unit: null,
      validation: {},
      width: 140,
      options: [],
    },
  ],
}

const rows: ScientificRowWire[] = [
  { id: 'row-1', version: 1, well: 'A1', od600: 0.052 },
  { id: 'row-2', version: 1, well: 'A2', od600: 0.118 },
  { id: 'row-3', version: 1, well: 'A3', od600: 0.341 },
]

function client(behaviour: 'loaded' | 'pending' | 'refused') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (behaviour === 'loaded') {
    queryClient.setQueryData(scientificQueryKeys.table(TABLE_ID), table)
    queryClient.setQueryData(scientificQueryKeys.allRows(TABLE_ID), rows)
    queryClient.setQueryData(scientificQueryKeys.formulas(TABLE_ID), [])
    return queryClient
  }
  const run =
    behaviour === 'pending'
      ? () => new Promise<never>(() => {})
      : () => Promise.reject(new Error('offline'))
  // Starting the read without awaiting it leaves the cache in the state the
  // block's own `useQuery` joins: pending on first paint, refused on failure.
  void queryClient.fetchQuery({
    queryKey: scientificQueryKeys.table(TABLE_ID),
    queryFn: run,
  })
  return queryClient
}

function withClient(behaviour: 'loaded' | 'pending' | 'refused') {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client(behaviour)}>
      <ScientificWorkbookProvider>
        <div className="w-[880px] max-w-full rounded-md border border-border">
          <Story />
        </div>
      </ScientificWorkbookProvider>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Sheet/Scientific sheet block',
  component: ScientificSheetBlock,
  tags: ['autodocs'],
  decorators: [withClient('loaded')],
  args: { block },
} satisfies Meta<typeof ScientificSheetBlock>
export default meta
type Story = StoryObj<typeof meta>

/** The loaded block: a two-column plate-reading table the writer can edit. */
export const Default: Story = {}

/** Read-only in a frozen revision or a submitted submission. */
export const ReadOnly: Story = { args: { readOnly: true } }

/** The table read in flight: the block keeps its chrome and states it. */
export const Loading: Story = { decorators: [withClient('pending')] }

/** A refused table read is reported instead of an empty grid. */
export const ReadRefused: Story = { decorators: [withClient('refused')] }

/** A block whose payload carries no table id reports that instead of
 * rendering an empty grid. */
export const MissingTableId: Story = {
  args: { block: { ...block, payload: { title: 'Plate readings' } } },
}
