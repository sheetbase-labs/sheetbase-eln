import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldScrubArea,
} from '#/components/reui/number-field'

/**
 * The vendored `@reui/number-field` copy (ADR-0055; `src/components/reui/`).
 *
 * It is a candidate, not an adoption: the comparison record
 * (`docs/knowledge/design/component-comparison-record.md`, row 2) declines it,
 * and the story stays because the code is in the tree and the harness pair
 * (`src/components/component-compare/pairs/quantity-field.tsx`) renders it.
 *
 * Reading the story at a glance: at its defaults the visible field is a text
 * input showing the value through the browser's number formatter. Type `1e-21`
 * and it becomes `1`, type `1.602176634e-19` and it reads `0` — the finding the
 * record rests on.
 */
const meta = {
  title: 'UI/NumberField',
  component: NumberField,
  tags: ['autodocs'],
  args: { defaultValue: 1.5, size: 'default' },
  render: (args) => (
    <div className="w-56">
      <NumberField {...args}>
        <NumberFieldScrubArea label="Quantity" />
        <NumberFieldGroup>
          <NumberFieldDecrement />
          <NumberFieldInput aria-label="Quantity" />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </NumberField>
    </div>
  ),
} satisfies Meta<typeof NumberField>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Invalid: Story = {
  render: () => (
    <div className="w-56">
      <NumberField required>
        <NumberFieldScrubArea label="Quantity" />
        <NumberFieldGroup aria-invalid>
          <NumberFieldDecrement />
          <NumberFieldInput aria-label="Quantity" />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </NumberField>
    </div>
  ),
}
