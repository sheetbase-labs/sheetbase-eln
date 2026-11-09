import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { TemplatePartsSection } from '#/components/templates/template-parts'
import type { TemplatePart } from '#/components/templates/template-parts'

/**
 * The days a notebook template splits an experiment into. Reading lists them;
 * editing adds, reorders and removes them. Nothing is saved from here.
 */
const initial: TemplatePart[] = [
  {
    id: '0198d970-e266-4000-8000-0000000000b1',
    title: 'Seed the cells',
    dayOffset: 0,
  },
  {
    id: '0198d970-e266-4000-8000-0000000000b2',
    title: 'Dose with compound',
    dayOffset: 1,
  },
  {
    id: '0198d970-e266-4000-8000-0000000000b3',
    title: 'Read the plate',
    dayOffset: 4,
  },
]

const meta = {
  title: 'Templates/Parts',
  component: TemplatePartsSection,
  tags: ['autodocs'],
  args: { parts: initial, placements: [], editable: false, onChange: () => {} },
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TemplatePartsSection>

export default meta

type Story = StoryObj<typeof meta>

export const Reading: Story = {}

export const None: Story = { args: { parts: [] } }

export const Editing: Story = {
  args: { editable: true },
  render: (args) => {
    const [parts, setParts] = useState(initial)

    return <TemplatePartsSection {...args} parts={parts} onChange={setParts} />
  },
}
