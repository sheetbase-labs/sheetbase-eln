import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { RecordPicker } from '#/components/scientific/record-picker'

const records = [
  { id: '1', kind: 'sample' as const, identifier: 'SMP-2026-0142', title: 'Human plasma aliquot', status: 'frozen', archivedAt: null },
  { id: '2', kind: 'sample' as const, identifier: 'SMP-2026-0143', title: 'Serum control', status: 'quarantined', archivedAt: null },
  { id: '3', kind: 'sample' as const, identifier: 'SMP-2025-0088', title: 'Legacy calibrator', status: 'consumed', archivedAt: '2026-01-02' },
]

const meta = {
  title: 'Scientific/Record picker',
  component: RecordPicker,
  tags: ['autodocs'],
  args: {
    kind: 'sample' as const,
    results: records,
    loading: false,
    onSearch: () => {},
    onSelect: () => {},
    includeArchived: true,
  },
} satisfies Meta<typeof RecordPicker>

export default meta
type Story = StoryObj<typeof meta>

export const Results: Story = {}

export const Loading: Story = {
  args: { loading: true, results: [] },
}

export const Empty: Story = {
  args: { results: [] },
}

const errorObj = Object.assign(new Error(), { message: 'Registry service is unavailable' })

export const PickerError: Story = {
  args: { results: [], error: errorObj },
}
