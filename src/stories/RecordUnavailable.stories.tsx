import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordUnavailable } from '#/components/ui/record-unavailable'

const settled = {
  isLoading: false,
  isError: false,
  error: null,
  refetch: () => undefined,
}

/**
 * The body of a record page whose record isn't there: nothing while it
 * loads, a retry when the read failed, otherwise the not-found notice with a
 * way back to the list.
 */
const meta = {
  title: 'UI/v3 Record unavailable',
  component: RecordUnavailable,
  tags: ['autodocs'],
  args: {
    what: 'sample',
    back: { to: '/samples', label: 'Back to samples' },
    query: settled,
  },
} satisfies Meta<typeof RecordUnavailable>

export default meta

type Story = StoryObj<typeof meta>

export const NotFound: Story = {}

export const ReadFailed: Story = {
  args: {
    query: { ...settled, isError: true, error: new Error('Network error') },
  },
}
