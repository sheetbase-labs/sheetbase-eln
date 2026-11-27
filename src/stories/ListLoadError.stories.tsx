import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ListLoadError } from '#/components/ui/list-load-error'

/**
 * What a list shows when its data did not load: a failed read is never an
 * empty list, so this takes the empty state's place and offers a retry.
 */
const meta = {
  title: 'UI/ListLoadError',
  component: ListLoadError,
  tags: ['autodocs'],
  args: { list: 'experiments', onRetry: () => undefined },
} satisfies Meta<typeof ListLoadError>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Retrying: Story = { args: { retrying: true } }
