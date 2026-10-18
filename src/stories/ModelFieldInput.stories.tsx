import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ModelFieldInput } from '#/components/scientific/model-field-input'
import type { ModelFieldDefinition } from '#/lib/model-fields'

/**
 * Model-field editor. The control follows the field's logical type, so each
 * story defines one field; `value`/`onChange` are controlled and the wrapper
 * keeps them in state so typing works in the canvas.
 */
function field(
  overrides: Partial<ModelFieldDefinition> = {},
): ModelFieldDefinition {
  return {
    id: 'field-1',
    modelKey: 'sample',
    fieldName: 'concentration',
    label: 'Concentration',
    description: null,
    displayOrder: 1,
    logicalType: 'text',
    nullable: true,
    defaultValue: null,
    unit: null,
    validation: {},
    lifecycle: 'active',
    options: [],
    ...overrides,
  }
}

function Harness({
  definition,
  initial = '',
  showLabel,
}: {
  definition: ModelFieldDefinition
  initial?: string | boolean
  showLabel?: boolean
}) {
  const [value, setValue] = useState<string | boolean>(initial)
  return (
    <ModelFieldInput
      definition={definition}
      value={value}
      onChange={setValue}
      showLabel={showLabel}
    />
  )
}

const meta = {
  title: 'Scientific/Model field input',
  component: ModelFieldInput,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { definition: field(), value: '', onChange: () => {} },
} satisfies Meta<typeof ModelFieldInput>
export default meta
type Story = StoryObj<typeof meta>

export const Text: Story = {
  render: () => <Harness definition={field()} initial="42.7" />,
}

/** A numeric field states its unit beside the control. */
export const NumberWithUnit: Story = {
  render: () => (
    <Harness
      definition={field({
        logicalType: 'decimal',
        label: 'Concentration',
        unit: { storageUnit: 'ng/µL' },
      })}
      initial="42.7"
    />
  ),
}

/** Booleans are a labelled checkbox, not a select. */
export const Boolean: Story = {
  render: () => (
    <Harness
      definition={field({ logicalType: 'boolean', label: 'Approved' })}
      initial={false}
    />
  ),
}

/** Categories offer only active options. */
export const Category: Story = {
  render: () => (
    <Harness
      definition={field({
        logicalType: 'category',
        label: 'Material class',
        options: [
          {
            id: '1',
            key: 'active',
            label: 'Active',
            displayOrder: 1,
            lifecycle: 'active',
          },
          {
            id: '2',
            key: 'excipient',
            label: 'Excipient',
            displayOrder: 2,
            lifecycle: 'active',
          },
        ],
      })}
      initial="active"
    />
  ),
}

/** A retired option the record already holds stays selectable. */
export const RetiredCategory: Story = {
  render: () => (
    <Harness
      definition={field({
        logicalType: 'category',
        label: 'Material class',
        options: [
          {
            id: '1',
            key: 'active',
            label: 'Active · retired',
            displayOrder: 1,
            lifecycle: 'retired',
          },
        ],
      })}
      initial="active"
    />
  ),
}

/** A nullable empty value is allowed and shown as unset. */
export const EmptyNullable: Story = {
  render: () => <Harness definition={field({ nullable: true })} initial="" />,
}

/** Without a label the control sits in its own cell (table rows). */
export const WithoutLabel: Story = {
  render: () => (
    <Harness definition={field()} initial="42.7" showLabel={false} />
  ),
}

/** A required field states the constraint in its hint. */
export const RequiredConstraint: Story = {
  render: () => (
    <Harness
      definition={field({
        nullable: false,
        validation: { maxLength: 12 },
      })}
      initial="LVV-CAR-T"
    />
  ),
}
