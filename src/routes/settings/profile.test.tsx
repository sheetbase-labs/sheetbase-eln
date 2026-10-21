/**
 * SET-03.1 — the profile display name. The write is resolved on the server, so
 * it saves where Better Auth has no session to offer (the auth-free development
 * deployment) and reports why when it cannot, instead of leaving the field
 * looking saved or answering with a bare "Unauthorized".
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './profile'

const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
const profileData = vi.hoisted(() => ({ updateProfileNameFn: vi.fn() }))
const router = vi.hoisted(() => ({ invalidate: vi.fn(async () => {}) }))

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
})
