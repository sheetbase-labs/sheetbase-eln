import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { RecordPicker } from '#/components/scientific/record-picker'
import type { NotebookRecord } from '#/lib/notebook-data'

const records: NotebookRecord[] = [
  {
    id: '1',
    projectId: null,
    kind: 'sample',
    identifier: 'SMP-2026-0142',
    title: 'Human plasma aliquot',
    status: 'frozen',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'user',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
  },
  {
    id: '2',
    projectId: null,
    kind: 'sample',
    identifier: 'SMP-2026-0143',
    title: 'Serum control',
    status: 'quarantined',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'user',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
  },
  {
    id: '3',
    projectId: null,
    kind: 'sample',
    identifier: 'SMP-2025-0088',
    title: 'Legacy calibrator',
    status: 'consumed',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    archivedAt: '2026-01-02',
    deletedAt: null,
    createdByUserId: 'user',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
  },
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

const errorObj = Object.assign(new Error(), {
  message: 'Registry service is unavailable',
})

export const PickerError: Story = {
  args: { results: [], error: errorObj },
}
