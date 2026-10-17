import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetRecordPicker } from '#/components/sheet/sheet-record-picker'
import type { NotebookRecord } from '#/lib/notebook-data'

/**
 * EXP-04 record picker for a sheet cell. It is a controlled search surface:
 * the caller debounces and supplies `results`, so these stories pass static
 * hits for each state the panel can be in.
 */
function record(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: 'p-1',
    kind: 'sample',
    identifier: 'SMP-2026-0001',
    title: 'LV harvest',
    status: 'available',
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u-1',
    updatedByUserId: null,
    properties: {},
    lockedAt: null,
    lockedByRevisionId: null,
    ...overrides,
  }
}

const results: NotebookRecord[] = [
  record(),
  record({
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'material',
    identifier: 'MAT-2026-0004',
    title: 'HEK293T culture medium',
    status: 'in-use',
  }),
]

const meta = {
  title: 'Sheet/Sheet record picker',
  component: SheetRecordPicker,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[520px]">
        <Story />
      </div>
    ),
  ],
  args: {
    modelKey: 'sample',
    results,
    loading: false,
    onSearch: () => {},
    onSelect: () => {},
  },
} satisfies Meta<typeof SheetRecordPicker>
export default meta
type Story = StoryObj<typeof meta>

export const Results: Story = {}

/** Mid-search: the list holds its place rather than emptying. */
export const Searching: Story = { args: { loading: true } }

/** Nothing matched, stated as a fact about the query. */
export const NoMatches: Story = { args: { results: [] } }

/** A failed search is reported with the reason from the read. */
export const SearchError: Story = {
  args: { results: [], error: new Error('The record search was refused.') },
}

/** A row is already chosen, so the picker shows it selected. */
export const Selected: Story = {
  args: { selectedId: results[0].id },
}

/** Archived records are opt-in, not mixed into the live list. */
export const IncludingArchived: Story = {
  args: {
    includeArchived: true,
    results: [record({ archivedAt: '2026-06-01T10:00:00Z' })],
  },
}

/** The same picker for a material column. */
export const MaterialKind: Story = {
  args: { modelKey: 'material', results: [results[1]] },
}
