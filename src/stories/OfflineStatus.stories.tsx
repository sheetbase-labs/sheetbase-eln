import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { OfflineEditsProvider } from '#/components/offline/offline-edits'
import {
  OfflineStatusBanner,
  UnsyncedChangesSection,
} from '#/components/offline/offline-status'
import { EDITS, SCOPE, seededStore } from './offline-fixtures'

/**
 * The connected offline surfaces the notebook mounts. The status banner reads
 * the live-event status, and with no stream mounted the status is the initial
 * `offline` snapshot, so these stories show the banner a person sees while the
 * connection is down. It renders nothing before mount, so server markup never
 * claims "offline".
 */
const meta = {
  title: 'Offline/Status',
  component: OfflineStatusBanner,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof OfflineStatusBanner>

export default meta

type Story = StoryObj<typeof meta>

/** Offline with two drafts waiting on the device. */
export const OfflineWithDrafts: Story = {
  decorators: [
    (Story) => (
      <OfflineEditsProvider
        store={seededStore(EDITS.slice(0, 2))}
        scope={SCOPE}
      >
        <Story />
      </OfflineEditsProvider>
    ),
  ],
}

/** Offline with nothing waiting. */
export const OfflineNothingWaiting: Story = {}

/** The workspace has offline editing off: no capabilities note, and the copy says edits are not kept. */
export const OfflineEditingOff: Story = {
  args: { offlineEditingAllowed: false },
}

/** The inspector's list, fed from the device store. */
export const InspectorSection: Story = {
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <OfflineEditsProvider store={seededStore()} scope={SCOPE}>
        <div className="w-80">
          <Story />
        </div>
      </OfflineEditsProvider>
    ),
  ],
  render: () => <UnsyncedChangesSection />,
}

/** With nothing waiting the section renders nothing at all. */
export const InspectorSectionSilent: Story = {
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <OfflineEditsProvider store={seededStore([])} scope={SCOPE}>
        <div className="w-80 text-label text-fg-muted">
          <Story />
          (nothing rendered above this line)
        </div>
      </OfflineEditsProvider>
    ),
  ],
  render: () => <UnsyncedChangesSection />,
}
