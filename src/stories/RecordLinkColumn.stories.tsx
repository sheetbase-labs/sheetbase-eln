import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordLinkValue } from '#/components/datasets/record-link-value'
import { RecordTypeSelect } from '#/components/models/record-type-select'

/**
 * A measurement table column that links to a record. The cell shows the
 * record's identifier as a link (never its id), and the column's editor picks
 * the record type it links to.
 */
const SAMPLE = '5b6a4c1e-6a43-4d6f-8f29-1e6b0c1d9a01'
const CELL_BANK = '5b6a4c1e-6a43-4d6f-8f29-1e6b0c1d9a02'

const labels = {
  [SAMPLE]: {
    id: SAMPLE,
    kind: 'sample',
    identifier: 'SMP-2231',
    title: 'Harvest lot HL-0934',
  },
  [CELL_BANK]: {
    id: CELL_BANK,
    kind: 'cell_bank',
    identifier: 'CB-0006',
    title: 'HEK293 working bank',
  },
}

const meta = {
  title: 'Data/Record link column',
  component: RecordLinkValue,
  args: { value: SAMPLE, labels },
} satisfies Meta<typeof RecordLinkValue>

export default meta

type Story = StoryObj<typeof meta>

/** A linked sample: its identifier opens the sample. */
export const LinkedSample: Story = {}

/** A record type the lab defined opens the generic record page. */
export const LinkedCellBank: Story = { args: { value: CELL_BANK } }

/** No value, or a record this person cannot see: a dash, never a raw id. */
export const Empty: Story = { args: { value: null } }

export const Unreadable: Story = {
  args: { value: 'a0000000-0000-4000-8000-000000000000' },
}

/** The column editor's "Links to" picker, with a built-in type chosen. */
export const ChooseRecordType: Story = {
  render: () => (
    <QueryClientProvider client={new QueryClient()}>
      <RecordTypeSelect
        ariaLabel="Links to"
        value="sample"
        onValueChange={() => undefined}
      />
    </QueryClientProvider>
  ),
}
