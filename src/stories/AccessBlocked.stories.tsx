import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AccessBlockedSurface } from '#/components/shell/access-blocked'
import { screenRoutes } from './screen-stories'

/**
 * A signed-in person with no usable workspace. A suspension and a removal are
 * not an outage, so the screen names the cause, who can act, and offers
 * sign-out and any workspace the person can still open. This is the surface
 * without its router and auth wiring; the handlers are the story's.
 */
const meta = {
  title: 'Shell/Access blocked',
  component: AccessBlockedSurface,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    tanstack: { router: { route: screenRoutes('/'), path: '/' } },
  },
  args: {
    user: { name: 'Dana Whitfield', email: 'dana@acme-bio.com' },
    suspendedWorkspace: { name: 'Acme Bio' },
    contacts: [
      { name: 'Priya Nair', email: 'priya@acme-bio.com', role: 'Owner' },
      { name: 'Tom Ellis', email: 'tom@acme-bio.com', role: 'Admin' },
    ],
    otherWorkspaces: [],
    onSwitch: async () => {},
    onSignOut: async () => {},
  },
} satisfies Meta<typeof AccessBlockedSurface>

export default meta

type Story = StoryObj<typeof meta>

/** Membership suspended, with the people who can reinstate it. */
export const Suspended: Story = {}

/** Suspended, but no one is listed: the screen says to ask whoever manages the lab. */
export const SuspendedNoContacts: Story = { args: { contacts: [] } }

/** Suspended here, with another workspace still open. */
export const OtherWorkspace: Story = {
  args: { otherWorkspaces: [{ id: 'w2', name: 'Acme Bio Pilot Plant' }] },
}

/** Removed from every workspace. */
export const NoWorkspace: Story = {
  args: { suspendedWorkspace: null, contacts: [] },
}

/** Sign-out was not confirmed: the error shows and the buttons come back. */
export const SignOutFails: Story = {
  args: {
    onSignOut: async () => {
      throw new Error('sign out')
    },
  },
}
