import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { FormSection } from '#/components/ui/form-section'
import { Input } from '#/components/ui'

const meta = {
  title: 'Forms/Form section',
  component: FormSection,
  parameters: { layout: 'padded' },
  args: {
    title: 'Inputs',
    hint: 'Name the dataset used by this step. Choose a saved version when you run the pipeline.',
    children: <Input aria-label="Input name" defaultValue="measurements" />,
  },
} satisfies Meta<typeof FormSection>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
