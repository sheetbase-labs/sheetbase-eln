import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  InspectorSection,
  InspectorSectionStack,
} from '#/components/record/inspector-sections'

/**
 * The stack is the one element that owns the 16px cadence between inspector
 * sections; stories render three sections so the rhythm is visible.
 */
const meta = {
  title: 'Record/Inspector sections/Section stack',
  component: InspectorSectionStack,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: {
    children: (
      <>
        <InspectorSection title="Identifiers">
          <p className="text-xs text-fg-muted">EXP-2026-0042</p>
        </InspectorSection>
        <InspectorSection title="Storage">
          <p className="text-xs text-fg-muted">Freezer 2 · Shelf B</p>
        </InspectorSection>
        <InspectorSection title="Notes">
          <p className="text-xs text-fg-muted">
            Aliquot on ice before the thaw.
          </p>
        </InspectorSection>
      </>
    ),
  },
} satisfies Meta<typeof InspectorSectionStack>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A caller-supplied class can tighten or loosen the stack for one surface. */
export const CustomSpacing: Story = { args: { className: 'space-y-8' } }
