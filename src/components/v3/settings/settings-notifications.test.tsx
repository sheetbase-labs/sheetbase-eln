/**
 * WORK-03.1 — the notification preferences panel. Save is a write of every
 * row plus the timing, so it stays inert until the form differs from what the
 * server last returned; the panel's own copy states the times are UTC.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotificationTiming } from '#/lib/notification-preferences'

import { SettingsNotifications } from './settings-notifications'

const { savePreference, saveTiming } = vi.hoisted(() => ({
  savePreference: vi.fn(async (..._args: unknown[]) => {}),
  saveTiming: vi.fn(async (..._args: unknown[]) => {}),
}))

const toasts = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('#/components/v3/ui/sonner', () => ({ toast: toasts.toast }))

const SAVED_TIMING: NotificationTiming = {
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  digestTime: '08:00',
}

vi.mock('#/lib/notification-preferences', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchNotificationPreferences: async () => [
    { eventType: 'review_requested', inApp: true, email: true, digest: false },
    { eventType: 'material_expiring', inApp: true, email: true, digest: false },
  ],
  fetchNotificationTiming: async () => SAVED_TIMING,
  saveNotificationPreference: (...args: unknown[]) => savePreference(...args),
  saveNotificationTiming: (...args: unknown[]) => saveTiming(...args),
}))

afterEach(() => {
  cleanup()
  savePreference.mockClear()
  saveTiming.mockClear()
  toasts.toast.mockClear()
})

function renderPanel() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <SettingsNotifications />
    </QueryClientProvider>,
  )
}

describe('SettingsNotifications', () => {
  it('keeps Save disabled until a preference actually changes, then writes both parts', async () => {
    const user = userEvent.setup()
    renderPanel()

    const save = await screen.findByRole('button', { name: 'Save changes' })
    await waitFor(() => expect(save).toHaveProperty('disabled', true))
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Review requested from you email',
      }),
    )
    await waitFor(() => expect(save).toHaveProperty('disabled', false))

    await user.click(save)
    await waitFor(() =>
      expect(savePreference).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'review_requested', email: false }),
      ),
    )
    expect(saveTiming).toHaveBeenCalledWith(SAVED_TIMING)
    // A resolved save is confirmed in words; the button going quiet again is
    // not a confirmation.
    await waitFor(() =>
      expect(toasts.toast).toHaveBeenCalledWith('Notification settings saved'),
    )
  })

  it('does not confirm a save that failed', async () => {
    saveTiming.mockRejectedValueOnce(new Error('Could not save the digest time.'))
    const user = userEvent.setup()
    renderPanel()

    const save = await screen.findByRole('button', { name: 'Save changes' })
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Review requested from you email',
      }),
    )
    await waitFor(() => expect(save).toHaveProperty('disabled', false))
    await user.click(save)

    expect(
      await screen.findByText('Could not save the digest time.'),
    ).toBeTruthy()
    expect(toasts.toast).not.toHaveBeenCalled()
  })

  it('treats a changed quiet hour or digest time as unsaved work', async () => {
    const user = userEvent.setup()
    renderPanel()

    const save = await screen.findByRole('button', { name: 'Save changes' })
    await waitFor(() =>
      expect(screen.getByLabelText('Digest time')).toHaveProperty(
        'value',
        '08:00',
      ),
    )
    // Only the timing differs from the saved values, never a channel.
    await user.clear(screen.getByLabelText('Quiet hours end'))
    await user.type(screen.getByLabelText('Quiet hours end'), '06:30')
    await waitFor(() => expect(save).toHaveProperty('disabled', false))
  })
})
