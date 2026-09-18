import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ModelProperties } from '#/components/scientific/model-properties'
import { Inspector } from '#/components/record/inspector'
import {
  InspectorSection,
  InspectorSectionStack,
} from '#/components/record/inspector-sections'
import { Property, PropertyList } from '#/components/scientific/property-list'
import { Badge } from '#/components/ui/badge'

const tabs = [
  {
    id: 'properties',
    label: 'Properties',
    content: (
      <InspectorSectionStack>
        <InspectorSection title="Record details">
          <PropertyList>
            <Property label="Identifier" mono>
              EXP-2025-0014
            </Property>
            <Property label="Owner">Dr. Maya Chen</Property>
            <Property label="Project">Vector stability</Property>
          </PropertyList>
        </InspectorSection>
        <InspectorSection title="Analysis">
          <PropertyList>
            <Property label="Formula" mono stacked>
              =IF(AND(A1&gt;0,B1&lt;10),"qualified","review")
            </Property>
            <Property label="Last modified">29 July 2025</Property>
          </PropertyList>
        </InspectorSection>
      </InspectorSectionStack>
    ),
  },
  {
    id: 'activity',
    label: 'Activity',
    badge: 3,
    content: (
      <ol className="space-y-4 text-sm">
        <li>
          <b>Dr. Maya Chen</b> updated the storage condition
          <p className="text-xs text-muted-foreground">Today, 09:42</p>
        </li>
        <li>
          <b>Alex Rivera</b> attached qPCR results
          <p className="text-xs text-muted-foreground">Yesterday, 16:18</p>
        </li>
      </ol>
    ),
  },
  {
    id: 'comments',
    label: 'Comments',
    badge: 2,
    content: (
      <p className="text-sm">Replicate two should be repeated before review.</p>
    ),
  },
]

const meta = {
  title: 'Record/Inspector',
  component: Inspector,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    recordType: 'Experiment',
    title: 'Virus Stability at 4 °C',
    status: <Badge variant="success">In progress</Badge>,
    tabs,
    className: 'h-[600px] w-[380px] border',
  },
} satisfies Meta<typeof Inspector>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = { args: { state: 'skeleton' } }
export const NoSelection: Story = {
  args: { state: 'no-selection', title: 'Inspector' },
}
export const Unavailable: Story = { args: { state: 'unavailable' } }
export const PermissionDenied: Story = { args: { state: 'permission-denied' } }

export const SampleDetails: Story = {
  args: {
    recordType: 'Sample',
    title: 'LVV-CAR-T retention aliquot — stability study reference material',
    status: <Badge variant="success">Available</Badge>,
    className: 'h-[800px] w-full max-w-[480px] border',
    tabs: [
      {
        id: 'details',
        label: 'Details',
        content: (
          <InspectorSectionStack>
            <ModelProperties
              title="Properties"
              lockedProperties={[
                { key: 'id', label: 'Sample ID', value: 'SMP-2025-0020' },
                { key: 'quantity', label: 'Quantity', value: '4 mL' },
                {
                  key: 'storage',
                  label: 'Storage',
                  stacked: true,
                  value:
                    'Cambridge site / Cold room 1 / Freezer FZ-80-01 / Shelf 2 / Rack 3 / BX-LVV-07 / A1',
                },
              ]}
              definitions={[]}
              values={{}}
            />
            <InspectorSection title="Chain of custody">
              <p className="text-sm leading-5">
                Transferred to retention storage on 7 September 2026.
              </p>
            </InspectorSection>
            <InspectorSection title="Linked experiments">
              <p className="text-xs text-muted-foreground">No linked records</p>
            </InspectorSection>
          </InspectorSectionStack>
        ),
      },
    ],
  },
}
