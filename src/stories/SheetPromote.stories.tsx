import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetPromote } from '#/components/sheet/sheet-promote'
import type { SheetPromoteLocalField } from '#/components/sheet/sheet-promote'

/**
 * The “promote a local column” dialog for a composed Sheet. It is a controlled
 * dialog: with `open` supplied the caller owns it, and `trigger={false}` is
 * how the workspace opens it from the column menu. The request itself is only
 * sent on submit.
 */
const field: SheetPromoteLocalField = {
  fieldId: '0198d970-e266-4000-8000-00000000f001',
  key: 'observation',
  label: 'Observation',
  logicalType: 'text',
  quantity: null,
}

const meta = {
  title: 'Sheet/Sheet promote',
  component: SheetPromote,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    instanceId: '0198d970-e266-4000-8000-000000000030',
    field,
    onSubmitted: () => {},
  },
} satisfies Meta<typeof SheetPromote>
export default meta
type Story = StoryObj<typeof meta>

/** Closed: the trigger the column menu renders. */
export const Trigger: Story = {}

/** Open, with the target choice and the reason the reviewer will read. */
export const Open: Story = {
  args: { open: true, trigger: false },
}

/** A quantity field carries its unit into the promotion. */
export const QuantityField: Story = {
  args: {
    open: true,
    trigger: false,
    field: {
      ...field,
      key: 'titre',
      label: 'Titre',
      logicalType: 'decimal',
      quantity: { storageUnit: 'vg/mL', preferredDisplayUnit: 'vg/mL' },
    },
  },
}

/** A caller-named trigger for surfaces that say what is being promoted. */
export const CustomTriggerLabel: Story = {
  args: { triggerLabel: 'Promote column' },
}
