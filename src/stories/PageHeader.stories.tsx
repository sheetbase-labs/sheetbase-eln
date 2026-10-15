import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { PageHeader } from '#/components/ui/page-header'
import { Button } from '#/components/v3/ui/button'

const args = {
  eyebrow: 'Experiments',
  title: 'Virus Stability at 4 °C',
  description: 'Evaluate concentrated lentiviral vector at 4 °C over 28 days.',
}
const meta = {
  title: 'UI/PageHeader',
  component: PageHeader,
  tags: ['autodocs'],
  args,
} satisfies Meta<typeof PageHeader>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const WithActions: Story = {
  args: {
    children: (
      <div className="flex gap-2">
        <Button>+ New experiment</Button>
        <Button variant="secondary">Export</Button>
      </div>
    ),
  },
}
export const NoEyebrow: Story = { args: { eyebrow: undefined } }
export const LongTitle: Story = {
  args: {
    title:
      'Long-term stability assessment of concentrated lentiviral vector preparations following repeated freeze–thaw cycles at multiple storage temperatures',
  },
}
