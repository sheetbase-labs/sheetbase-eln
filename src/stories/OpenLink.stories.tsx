import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { OpenLink } from '#/components/notebook/block-preview'

/**
 * The small in-block link the previews use for canonical destinations. The
 * Storybook TanStack framework supplies the router, so the href is real.
 */
const meta = {
  title: 'Notebook/Open link',
  component: OpenLink,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: { path: '/records/$recordId', params: { recordId: 'record-1' } },
    },
  },
  args: { to: '/records/record-1', children: 'Open experiment' },
} satisfies Meta<typeof OpenLink>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Several links read as a row of destinations under a preview. */
export const InRow: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <OpenLink {...args} />
      <OpenLink to="/datasets">Open dataset</OpenLink>
      <OpenLink to="/sheets">Open sheet</OpenLink>
    </div>
  ),
}
