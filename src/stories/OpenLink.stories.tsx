import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { OpenLink } from '#/components/notebook/block-preview'

/**
 * The small in-block link the previews use for canonical destinations. The
 * Storybook TanStack framework supplies the router, and the mount route has to
 * exist in it for `Link` to resolve: a `path` alone only moves the URL, so the
 * route is declared here as well.
 */
const meta = {
  title: 'Notebook/Open link',
  component: OpenLink,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: {
        route: { path: '/records/$recordId' },
        path: '/records/$recordId',
        params: { recordId: 'record-1' },
      },
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
      <OpenLink to="/records/record-2">Open sample</OpenLink>
      <OpenLink to="/records/record-3">Open protocol</OpenLink>
    </div>
  ),
}
