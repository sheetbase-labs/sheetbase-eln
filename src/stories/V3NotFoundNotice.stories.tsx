import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import { NotFoundNotice } from '#/components/v3/ui/not-found-notice'

/**
 * A read that succeeded and found nothing. It can't tell a wrong link from a
 * record the person may not see, so it says both and names who can resolve it.
 * A failed read is a different state and offers a retry instead.
 */
const meta = {
  title: 'UI/v3 Not found notice',
  component: NotFoundNotice,
  tags: ['autodocs'],
} satisfies Meta<typeof NotFoundNotice>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { what: 'pipeline' } }

export const WithAction: Story = {
  args: {
    what: 'pipeline',
    action: <Button size="sm">Back to Pipelines</Button>,
  },
}
