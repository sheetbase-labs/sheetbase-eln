/**
 * SET-03.1 — the profile display name. The write is resolved on the server, so
 * it saves where Better Auth has no session to offer (the auth-free development
 * deployment) and reports why when it cannot, instead of leaving the field
 * looking saved or answering with a bare "Unauthorized".
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as UserPreferences from '#/lib/user-preferences'
import { Route } from './profile'

const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
const profileData = vi.hoisted(() => ({ updateProfileNameFn: vi.fn() }))
const preferences = vi.hoisted(() => ({
  setUserTimeZone: vi.fn(async () => {}),
}))
const router = vi.hoisted(() => ({ invalidate: vi.fn(async () => {}) }))

vi.mock('#/lib/user-preferences', async (importActual) => ({
  ...(await importActual<typeof UserPreferences>()),
  setUserTimeZone: preferences.setUserTimeZone,
}))
vi.mock('#/components/v3/ui/sonner', () => ({ toast: sonner.toast }))
vi.mock('#/components/v3/settings/settings-profile-data', () => profileData)
vi.mock('#/components/v3/settings/settings-two-factor', () => ({
  SettingsTwoFactor: () => null,
}))
vi.mock('#/components/v3/settings/settings-sessions', () => ({
  SettingsSessions: () => null,
}))
vi.mock('#/components/v3/lib/theme', () => ({
  useTheme: () => ({ pref: 'system', setPref: vi.fn() }),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: {
          id: 'gareth',
          name: 'Gareth P.',
          email: 'owner@sheetbase.test',
        },
        workspace: { id: 'ws', role: 'owner' },
        timeZone: 'Europe/London',
      },
    }),
  }),
  useRouter: () => router,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  profileData.updateProfileNameFn.mockResolvedValue({ name: 'Gareth P. QA3' })
})

function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Profile component required')
  return render(<Component />)
}

describe('Profile settings', () => {
  it('saves the name and re-resolves the shell context', async () => {
    const user = userEvent.setup()
    renderRoute()

    const name = screen.getByRole('textbox', { name: /Full name/ })
    await user.clear(name)
    await user.type(name, 'Gareth P. QA3')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(profileData.updateProfileNameFn).toHaveBeenCalledWith({
        data: { name: 'Gareth P. QA3' },
      }),
    )
    expect(router.invalidate).toHaveBeenCalled()
    expect(sonner.toast).toHaveBeenCalledWith('Changes saved')
  })

  it('states why a refused save did not happen', async () => {
    const user = userEvent.setup()
    profileData.updateProfileNameFn.mockRejectedValue(
      new Error('Your session has ended. Sign in again to change your name.'),
    )
    renderRoute()

    const name = screen.getByRole('textbox', { name: /Full name/ })
    await user.clear(name)
    await user.type(name, 'Gareth P. QA3')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(sonner.toast).toHaveBeenCalledWith('Could not save your profile', {
        description:
          'Your session has ended. Sign in again to change your name.',
      }),
    )
    expect(router.invalidate).not.toHaveBeenCalled()
  })

  it('saves the time zone to the person’s own profile', async () => {
    const user = userEvent.setup()
    renderRoute()

    const zone = screen.getByRole('combobox', { name: /Time zone/ })
    expect(screen.getByDisplayValue('Europe/London')).toBe(zone)
    await user.clear(zone)
    await user.type(zone, 'America/New_York')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(preferences.setUserTimeZone).toHaveBeenCalledWith(
        expect.anything(),
        'America/New_York',
      ),
    )
    expect(sonner.toast).toHaveBeenCalledWith('Changes saved')
  })

  it('refuses a time zone name that does not exist', async () => {
    const user = userEvent.setup()
    renderRoute()

    const zone = screen.getByRole('combobox', { name: /Time zone/ })
    await user.clear(zone)
    await user.type(zone, 'Mars/Olympus')

    expect(screen.getByText(/Use a time zone name such as/)).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Save changes' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(preferences.setUserTimeZone).not.toHaveBeenCalled()
  })
})
