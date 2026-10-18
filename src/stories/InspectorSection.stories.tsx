import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  InspectorSection,
  InspectorSectionStack,
} from '#/components/record/inspector-sections'
import { Property, PropertyList } from '#/components/scientific/property-list'
import { Button } from '#/components/v3/ui/button'

/** Section chrome: a dividing rule, a title, and an optional action. */
const meta = {
  title: 'Record/Inspector sections/Section',
  component: InspectorSection,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Identifiers',
    children: (
      <PropertyList>
        <Property label="ID">EXP-2026-0042</Property>
        <Property label="Protocol">PRT-2026-0012</Property>
      </PropertyList>
    ),
  },
} satisfies Meta<typeof InspectorSection>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** An action sits on the title row, right-aligned. */
export const WithAction: Story = {
  args: {
    action: (
      <Button size="sm" variant="quiet">
        Edit
      </Button>
    ),
  },
}

/** Only the first section drops its top rule, so stacked sections read as one
 * column rather than a card. */
export const Stacked: Story = {
  render: (args) => (
    <InspectorSectionStack>
      <InspectorSection {...args} />
      <InspectorSection title="Storage">
        <PropertyList>
          <Property label="Location">Freezer 2 · Shelf B</Property>
          <Property label="Temperature">−80 °C</Property>
        </PropertyList>
      </InspectorSection>
      <InspectorSection title="Notes">
        <p className="text-xs leading-5 text-fg-muted">
          Aliquot on ice before the second thaw.
        </p>
      </InspectorSection>
    </InspectorSectionStack>
  ),
}
