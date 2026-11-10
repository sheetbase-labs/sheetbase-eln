import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ScientificRecordSummary } from '#/components/scientific/scientific-record-summary'
import type { NotebookRecord } from '#/lib/notebook-data'
import type { RecordFieldDefinition } from '#/lib/scientific-records'

const record: NotebookRecord = {
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
  createdByUserId: 'user-1',
  updatedByUserId: null,
  properties: { matrix: 'Plasma', quantity: 2.4, storage_temperature: -80 },
  lockedAt: null,
  lockedByRevisionId: null,
}

const fields: RecordFieldDefinition[] = [
  {
    id: 'f-1',
    workspaceId: 'workspace-1',
    kind: 'sample',
    fieldName: 'matrix',
    label: 'Matrix',
    description: null,
    displayOrder: 0,
    logicalType: 'text',
    nullable: false,
    defaultValue: null,
    unit: null,
    validation: {},
    lifecycle: 'active',
  },
  {
    id: 'f-2',
    workspaceId: 'workspace-1',
    kind: 'sample',
    fieldName: 'quantity',
    label: 'Remaining volume',
    description: null,
    displayOrder: 1,
    logicalType: 'decimal',
    nullable: true,
    defaultValue: null,
    unit: { symbol: 'mL' },
    validation: {},
    lifecycle: 'active',
  },
  {
    id: 'f-3',
    workspaceId: 'workspace-1',
    kind: 'sample',
    fieldName: 'storage_temperature',
    label: 'Storage temperature',
    description: null,
    displayOrder: 2,
    logicalType: 'decimal',
    nullable: true,
    defaultValue: null,
    unit: { symbol: '°C' },
    validation: {},
    lifecycle: 'active',
  },
]

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
