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
  LinkedRecordList,
  Property,
  PropertyList,
} from '#/components/record/inspector-sections'
import {
  Badge,
  Button,
  ButtonGroup,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  Textarea,
} from '#/components/ui'

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
                  <Property label="Identifier" mono stacked>
                    {row
                      ? `${row.identifier}-PLASMA-ALIQUOT-7F3A-2026-03-14`
                      : '—'}
                  </Property>
                  <Property label="Concentration" mono>
                    {row ? `${row.concentration} ng/µL` : '—'}
                  </Property>
                  <Property label="Material">EDTA plasma</Property>
                  <Property label="Batch" mono>
                    PL-2026-0314-A
                  </Property>
                </PropertyList>
              </InspectorSection>
              <InspectorSection title="Storage & custody">
                <PropertyList>
                  <Property label="Location" stacked mono>
                    North campus / Building 2 / Freezer FZ-04 / Rack C / Box 12
                    / C07
                  </Property>
                  <Property label="Received">14 Mar 2026, 09:42</Property>
                  <Property label="Custodian">Dr. Maya Chen</Property>
                  <Property label="Temperature" mono>
                    −80 °C
                  </Property>
                </PropertyList>
              </InspectorSection>
              <InspectorSection title="Quality & provenance">
                <PropertyList>
                  <Property label="Volume" mono>
                    450 µL
                  </Property>
                  <Property label="Freeze / thaw" mono>
                    1 cycle
                  </Property>
                  <Property label="Source study">
                    Viral stability study
                  </Property>
                </PropertyList>
              </InspectorSection>
              <InspectorSection title="Analysis">
                <PropertyList>
                  <Property label="Formula" mono stacked>
                    =IF(AND(A1&gt;0,B1&lt;10,C1="PASS"),"qualified","review")
                  </Property>
                  <Property label="Result">Qualified for extraction</Property>
                </PropertyList>
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
        {
          id: 'lineage',
          label: 'Lineage',
          badge: 3,
          content: (
            <InspectorSectionStack>
              <InspectorSection title="Linked records">
                <LinkedRecordList
                  items={[
                    {
                      id: 'study-1',
                      type: 'Study',
                      title: 'Viral stability study',
                      meta: 'Source study',
                    },
                    {
                      id: 'parent-1',
                      type: 'Sample',
                      title: 'PL-2026-0314 parent pool',
                      meta: 'Parent material',
                    },
                    {
                      id: 'dataset-1',
                      type: 'Dataset',
                      title: 'qPCR release panel',
                      meta: 'Derived measurement',
                    },
                  ]}
                />
              </InspectorSection>
              <InspectorSection title="Recent activity">
                <ol className="space-y-3 text-xs text-muted-foreground">
                  <li>
                    <span className="font-medium text-foreground">
                      Maya Chen
                    </span>{' '}
                    placed the aliquot in FZ-04.
                    <p className="mt-0.5">Today, 09:42</p>
                  </li>
                  <li>
                    <span className="font-medium text-foreground">System</span>{' '}
                    recorded the release-panel result.
                    <p className="mt-0.5">Yesterday, 16:18</p>
                  </li>
                </ol>
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
        {
          id: 'actions',
          label: 'Actions',
          content: (
            <InspectorSectionStack>
              <InspectorSection title="Update storage">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="fixture-location">Location</FieldLabel>
                    <Input
                      id="fixture-location"
                      defaultValue="FZ-04 / Rack C / Box 12 / C07"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fixture-state">
                      Sample state
                    </FieldLabel>
                    <Select id="fixture-state" defaultValue="frozen">
                      <option value="frozen">Frozen</option>
                      <option value="quarantined">Quarantined</option>
                      <option value="consumed">Consumed</option>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fixture-note">
                      Transfer note
                    </FieldLabel>
                    <Textarea
                      id="fixture-note"
                      defaultValue="Moved after QC release; maintain −80 °C chain of custody."
                    />
                  </Field>
                </FieldGroup>
              </InspectorSection>
              <InspectorSection title="Actions">
                <div className="flex flex-col items-start gap-2">
                  <Button size="sm">Save changes</Button>
                  <ButtonGroup>
                    <Button variant="outline" size="sm">
                      Receive
                    </Button>
                    <Button variant="outline" size="sm">
                      Consume
                    </Button>
                  </ButtonGroup>
                  <Button variant="outline" size="sm">
                    Transfer
                  </Button>
                </div>
              </InspectorSection>
            </InspectorSectionStack>
          ),
        },
      ]}
      className="h-full"
    />
  )
}

const baseArgs = {
  registryId: 'samples',
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
