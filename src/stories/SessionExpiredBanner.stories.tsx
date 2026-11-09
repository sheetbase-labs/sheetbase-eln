import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SessionExpiredBanner } from '#/components/shell/session-expired-banner'

/**
 * The session ended while the tab was open. The banner names the cause and
 * offers a sign-in link that returns to this page; edits held on the device are
 * not discarded. `expired` overrides the central session-expiry signal so the
 * stories need no failing request.
 */
const meta = {
  title: 'Shell/Session expired banner',
  component: SessionExpiredBanner,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { expired: true, path: '/projects/p1/experiments' },
} satisfies Meta<typeof SessionExpiredBanner>

export default meta

type Story = StoryObj<typeof meta>

export const Expired: Story = {}

/** Signed in: the banner renders nothing. */
export const SilentWhileSignedIn: Story = { args: { expired: false } }
