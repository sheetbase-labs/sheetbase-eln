import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ScientificRecordSummary } from '#/components/scientific/scientific-record-summary'

const record = {
  id: '1',
  kind: 'sample',
  identifier: 'SMP-2026-0142',
  title: 'Human plasma aliquot',
  status: 'frozen',
  archivedAt: null,
  properties: { matrix: 'Plasma', quantity: 2.4, storage_temperature: -80 },
} as any
const fields = [
  { name: 'matrix', label: 'Matrix', kind: 'sample', type: 'text' },
  {
    name: 'quantity',
    label: 'Remaining volume',
    kind: 'sample',
    type: 'number',
    unit: 'mL',
  },
  {
    name: 'storage_temperature',
    label: 'Storage temperature',
    kind: 'sample',
    type: 'number',
    unit: '°C',
  },
] as any
const meta = {
  title: 'Scientific/Record summary',
  component: ScientificRecordSummary,
  tags: ['autodocs'],
  args: {
    record,
    fieldDefinitions: fields,
    linkedCounts: [
      { label: 'Experiments', count: 3 },
      { label: 'Datasets', count: 8 },
    ],
  },
} satisfies Meta<typeof ScientificRecordSummary>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Loading: Story = { args: { loading: true } }
export const EmptyProperties: Story = { args: { fieldDefinitions: [] } }
export const Archived: Story = {
  args: { record: { ...record, archivedAt: '2026-06-01T10:00:00Z' } },
}
