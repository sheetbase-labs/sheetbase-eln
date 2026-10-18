import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, userEvent, within } from 'storybook/test'

import { SettingsNotifications } from '#/components/v3/settings/settings-notifications'
import {
  defaultPreferences,
  notificationPreferencesQueryKeys,
} from '#/lib/notification-preferences'
import type {
  NotificationPreference,
  NotificationTiming,
} from '#/lib/notification-preferences'
import { holdRead, screenQueryClient, withApiReads } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Notification preferences (`src/routes/settings/notifications.tsx`): one row
 * per event kind, then quiet hours and the daily digest time.
 *
 * Two reads answer the screen — the saved preferences and the timing — and one
 * write runs on Save. The stories seed both reads; the only state they add is
 * the unsaved edit, which is the screen's own dirty check. Nothing saves.
 */

/** The saved rows: the model's defaults, with two of them changed. */
const savedRows: NotificationPreference[] = defaultPreferences().map((row) =>
  row.eventType === 'validation_error'
    ? { ...row, email: false, digest: true }
    : row.eventType === 'material_expiring'
      ? { ...row, inApp: false, email: false, digest: true }
      : row,
)

const savedTiming: NotificationTiming = {
  quietHoursStart: '19:00',
  quietHoursEnd: '07:00',
  digestTime: '08:30',
}

const meta = {
  title: 'Settings/Notifications',
  decorators: [
    withApiReads('error'),
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A story's read client: what it seeds, or the reads it answers with a refusal. */
function provider(data: ReadSeed[], refused = false) {
  const client = screenQueryClient({ data })
  if (refused) {
    holdRead(client, notificationPreferencesQueryKeys.preferences(), 'denied')
    holdRead(client, notificationPreferencesQueryKeys.timing(), 'denied')
  }
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

const saved: ReadSeed[] = [
  {
    key: notificationPreferencesQueryKeys.preferences(),
    value: savedRows,
  },
  { key: notificationPreferencesQueryKeys.timing(), value: savedTiming },
]

/** What the person saved. Save is inert until something changes. */
export const Saved: Story = {
  decorators: [provider(saved)],
  render: () => <SettingsNotifications />,
}

/**
 * An unsaved change to one channel. The write is a real RPC that runs on Save,
 * so this story stops at the dirtied form.
 */
export const UnsavedEdit: Story = {
  decorators: [provider(saved)],
  render: () => <SettingsNotifications />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('checkbox', {
        name: 'Validation error in your data email',
      }),
    )
    await expect(
      canvas.getByRole('button', { name: 'Save changes' }),
    ).toBeEnabled()
  },
}

/**
 * Both reads were refused. `fetchNotificationPreferences` merges the model's
 * defaults with whatever rows are saved, so a refused read leaves the person's
 * own row absent and the screen on the defaults: every event reaches them in app
 * and by email, no quiet hours and no digest time are set, and Save is inert
 * because nothing is dirty. A *pending* or *failed* read renders the same form —
 * this surface has no error slot until a save is attempted.
 */
export const DefaultsOnly: Story = {
  decorators: [provider([], true)],
  render: () => <SettingsNotifications />,
}
