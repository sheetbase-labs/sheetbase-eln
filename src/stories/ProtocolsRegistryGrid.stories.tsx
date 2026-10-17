import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type { RowSelectionState, SortingState } from '@tanstack/react-table'

import { ProtocolsRegistryGrid } from '#/components/v3/protocols/protocols-registry-grid'
import type { NotebookRecord } from '#/lib/notebook-data'

/**
 * The adopted registry screen, `src/routes/protocols.tsx`, rendered on fixture
 * records: ADR-0055 decision 4 asks for a story where the screen has no
 * design-parity row, and `/protocols` is not in the parity set. No route, query
 * or record is read — the records below are synthetic, and the name cells link
 * to a fixture id.
 */
function fixture(
  identifier: string,
  title: string,
  status: string,
  updatedAt: string,
): NotebookRecord {
  return {
    id: `00000000-0000-4000-8000-0000000000${identifier.slice(-3)}`,
    workspaceId: '00000000-0000-4000-8000-000000000000',
    projectId: null,
    folderId: null,
    kind: 'protocol_template',
    identifier,
    title,
    status,
    tags: [],
    structureVersion: 1,
    metadataVersion: 1,
    createdAt: updatedAt,
    updatedAt,
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'fixture-owner',
    updatedByUserId: 'fixture-owner',
    lockedAt: null,
    lockedByRevisionId: null,
    properties: {},
  } as NotebookRecord
}

const ROWS: NotebookRecord[] = [
  fixture('PRT-006', 'HEK293 transfection', 'active', '2026-09-25T08:40:00Z'),
  fixture(
    'PRT-009',
    'HEK293 WCB viability panel',
    'active',
    '2026-09-25T08:40:00Z',
  ),
  fixture(
    'PRT-012',
    'AAV full/empty ratio by AUC',
    'active',
    '2026-09-25T08:40:00Z',
  ),
  fixture(
    'PRT-018',
    'Hold parameters clarified',
    'under_review',
    '2026-09-25T08:40:00Z',
  ),
  fixture('PRT-025', 'Expansion media screen', 'draft', '2026-09-25T08:40:00Z'),
]

function FixtureScreen({
  rows = ROWS,
  isLoading = false,
}: {
  rows?: NotebookRecord[]
  isLoading?: boolean
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'updatedAt', desc: true },
  ])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})

  return (
    <div className="flex h-[520px] min-w-0 flex-col p-4">
      <ProtocolsRegistryGrid
        rows={rows}
        ownerLabel={() => 'Fixture owner'}
        isLoading={isLoading}
        sorting={sorting}
        onSortingChange={setSorting}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
      />
    </div>
  )
}

const meta = {
  title: 'UI/Protocols registry grid',
  component: FixtureScreen,
  tags: ['autodocs'],
} satisfies Meta<typeof FixtureScreen>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The grid's own loading state, which the route passes while the query runs. */
export const Loading: Story = { args: { isLoading: true } }

/** No rows for the tab. */
export const Empty: Story = { args: { rows: [] } }
