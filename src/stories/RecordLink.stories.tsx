import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { Icon } from '#/components/icons'
import { RecordLink } from '#/components/scientific/record-link'
import { Button } from '#/components/v3/ui/button'

const meta = {
  title: 'Scientific/Record link',
  component: RecordLink,
  tags: ['autodocs'],
  args: {
    type: 'Sample',
    title: 'Human plasma aliquot',
    meta: 'SMP-2026-0142 · 2.4 mL',
    icon: 'flask',
  },
} satisfies Meta<typeof RecordLink>
export default meta
type Story = StoryObj<typeof meta>
export const Available: Story = {}
export const States: Story = {
  render: () => (
    <div className="grid max-w-lg gap-2">
      {(
        ['available', 'missing', 'deleted', 'permission-restricted'] as const
      ).map((state) => (
        <RecordLink
          key={state}
          type="Sample"
          title={
            state === 'available' ? 'Human plasma aliquot' : 'Linked sample'
          }
          meta={`SMP-2026-0142 · ${state}`}
          state={state}
          actions={
            <Button variant="quiet" size="icon">
              <Icon name="more" />
            </Button>
          }
        />
      ))}
    </div>
  ),
}
