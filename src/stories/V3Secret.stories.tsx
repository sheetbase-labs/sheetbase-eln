import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Secret } from '#/components/v3/ui/secret'

/**
 * A value shown once — a new API token or a service credential. Pair it with a
 * warn Notice, and never show it again after the dialog closes; the copy control
 * is the whole point of the component, so the stories keep it in place.
 */
const meta = {
  title: 'v3 kit/Secret',
  component: Secret,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Secret>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { value: 'sbk_live_7f3c1a90e4b24d5f8a06c2d1e9b04f77' },
}

/** The dialog's own wording, which every call site overrides to match its action. */
export const CustomCopyLabel: Story = {
  args: {
    value: 'sbk_live_7f3c1a90e4b24d5f8a06c2d1e9b04f77',
    copyLabel: 'Copy token',
    copiedMessage: 'Token copied',
    failedMessage: 'Couldn’t copy. Select the token and copy it by hand.',
  },
}

/** A long credential must wrap rather than push the copy control out of the box. */
export const LongValueWraps: Story = {
  args: {
    value:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ3b3Jrc3BhY2UtMDFKOVo2MTVY',
  },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
}
