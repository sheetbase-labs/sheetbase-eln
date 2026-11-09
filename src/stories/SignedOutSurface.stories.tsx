import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SignedOutSurface } from '#/components/offline/signed-out-surface'

/**
 * What a person is told after signing out. The wording only promises that
 * unsynced work was kept when the device's retention marker reports drafts
 * waiting; a plain sign-out does not claim edits that do not exist.
 */
const meta = {
  title: 'Offline/Signed out surface',
  component: SignedOutSurface,
  tags: ['autodocs'],
  args: { retained: 0 },
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SignedOutSurface>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing was waiting: a plain sign-out. */
export const PlainSignOut: Story = {}

/** Drafts were kept on this device. */
export const EditsRetained: Story = { args: { retained: 3 } }
