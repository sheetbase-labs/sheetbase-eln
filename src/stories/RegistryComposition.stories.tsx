import type { Meta, StoryObj } from '@storybook/tanstack-react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  RegistryComposition,
  DEFAULT_REGISTRY_QUERY,
} from '#/components/registry/registry-composition'
import { Inspector } from '#/components/record/inspector'
import {
  InspectorSection,
  InspectorSectionStack,
  Property,
  PropertyList,
} from '#/components/record/inspector-sections'
import { Badge } from '#/components/ui/badge'

type Row = {
  id: string
  identifier: string
  title: string
  status: string
  concentration: number
}

const rows: Row[] = [
  {
    id: '1',
    identifier: 'SMP-2026-0142',
    title: 'Human plasma aliquot',
    status: 'Frozen',
    concentration: 42.7,
  },
  {
    id: '2',
    identifier: 'SMP-2026-0143',
    title: 'Serum control',
    status: 'Quarantined',
    concentration: 38.2,
  },
]

const columns: ColumnDef<unknown, unknown>[] = [
  { accessorKey: 'identifier', header: 'Identifier' },
  { accessorKey: 'title', header: 'Sample' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'concentration', header: 'ng/µL' },
]

const meta = {
  title: 'Registry/Registry composition',
  component: RegistryComposition,
  tags: ['autodocs'],
} satisfies Meta<typeof RegistryComposition>

export default meta
type Story = StoryObj<typeof meta>

function renderInspector(record: unknown) {
  const row = record as Row | null

  return (
    <Inspector
      recordType="Sample"
      title={row?.title ?? 'No sample selected'}
      status={<Badge variant="success">{row?.status ?? 'Available'}</Badge>}
      tabs={[
        {
          id: 'details',
          label: 'Details',
          content: (
            <InspectorSectionStack>
              <InspectorSection title="Record details">
                <PropertyList>
                  <Property label="Identifier" mono>
                    {row?.identifier ?? '—'}
                  </Property>
                  <Property label="Concentration" mono>
                    {row ? `${row.concentration} ng/µL` : '—'}
                  </Property>
                </PropertyList>
              </InspectorSection>
              <InspectorSection title="Analysis">
                <PropertyList>
                  <Property label="Formula" mono stacked>
                    =IF(AND(A1&gt;0,B1&lt;10),"qualified","review")
                  </Property>
                </PropertyList>
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
        {
          id: 'history',
          label: 'History',
          badge: 2,
          content: 'No changes today.',
        },
      ]}
      className="h-full"
    />
  )
}

const baseArgs = {
  registryId: 'samples',
  workspaceId: 'ws',
  userId: 'user',
  title: 'Sample registry',
  description: 'Biological samples and aliquots',
  rows,
  totalCount: 248,
  columns,
  query: DEFAULT_REGISTRY_QUERY,
  onQueryChange: () => {},
  getRowId: (r: unknown) => (r as Row).id,
  selectedId: '1',
  onSelectedIdChange: () => {},
  inspectorLabel: 'Record details',
  renderInspector,
  summaries: [
    { label: 'Total samples', value: 248 },
    { label: 'Frozen', value: 184 },
    { label: 'Quarantined', value: 7 },
  ],
  filterDefinitions: [
    { id: 'title', label: 'Search', placeholder: 'Identifier or title…' },
    {
      id: 'status',
      label: 'Status',
      options: [
        { value: 'frozen', label: 'Frozen' },
        { value: 'quarantined', label: 'Quarantined' },
      ],
    },
  ],
}

export const Default: Story = { args: baseArgs }

export const Loading: Story = { args: { ...baseArgs, loading: true } }

export const Empty: Story = { args: { ...baseArgs, rows: [], totalCount: 0 } }

const registryError = Object.assign(new Error(), { message: 'failed' })

export const RegistryError: Story = {
  args: { ...baseArgs, error: registryError, onRetry: () => {} },
}

export const PermissionDenied: Story = {
  args: { ...baseArgs, permissionDenied: true },
}
