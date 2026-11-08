import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { FieldForm } from '#/components/plugins/field-form'
import type { FieldValues } from '#/components/plugins/field-form'
import type { ExtensionField } from '#/lib/extensions/points'

/**
 * The form a plugin's declared inputs become: a calculator's inputs, an
 * exporter's options, a connector's parameters. The label and unit come from
 * the plugin, and a name with no label is spelled out.
 */
const fields: ExtensionField[] = [
  { name: 'reactions', type: 'integer', required: true, label: 'Reactions' },
  {
    name: 'per_reaction',
    type: 'number',
    required: true,
    label: 'Per reaction',
    unit: 'µL',
  },
  { name: 'overage', type: 'number', required: false, unit: '%' },
  { name: 'include_water', type: 'boolean', required: false },
]

function Demo({ masked }: { masked?: string[] }) {
  const [values, setValues] = useState<FieldValues>({
    reactions: '24',
    per_reaction: '20',
  })
  return (
    <div className="max-w-md">
      <FieldForm
        fields={fields}
        values={values}
        onChange={setValues}
        masked={masked}
      />
    </div>
  )
}

const meta: Meta<typeof Demo> = {
  title: 'Plugins/Field form',
  component: Demo,
}
export default meta

type Story = StoryObj<typeof Demo>

export const Filled: Story = {}
