import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  OfflineBanner,
  OfflineCapabilitiesNote,
} from '#/components/offline/offline-banner'

/**
 * The banner the notebook shows while the live-event stream is down. It says
 * three things honestly: the person is offline, their edits are held on this
 * device, and when the stream last synced. Nothing renders while online.
 */
const meta = {
  title: 'Offline/Banner',
  component: OfflineBanner,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    offline: true,
    lastSyncedAt: '2026-11-05T09:41:00.000Z',
    unsyncedCount: 2,
    onRetry: () => {},
  },
} satisfies Meta<typeof OfflineBanner>

export default meta

type Story = StoryObj<typeof meta>

export const Offline: Story = {}

/** This tab never caught up, so no time is invented. */
export const NotSyncedYet: Story = {
  args: { lastSyncedAt: null, unsyncedCount: 0 },
}

/** A reconnect attempt is in flight. */
export const Retrying: Story = { args: { retrying: true } }

/** The workspace has turned offline editing off, so edits are not kept. */
export const OfflineEditingOff: Story = {
  args: { offlineEditingAllowed: false, unsyncedCount: 0 },
}

/** Online, the banner is silent: the surface stays quiet when healthy. */
export const SilentWhenOnline: Story = { args: { offline: false } }

/** The explainer under the document: what works offline and what does not. */
export const CapabilitiesNote: Story = {
  render: () => <OfflineCapabilitiesNote />,
}
