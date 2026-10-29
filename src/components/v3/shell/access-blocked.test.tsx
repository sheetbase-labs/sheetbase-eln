import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pickActiveMembership } from '#/lib/active-membership'
import { AccessBlockedSurface } from './access-blocked'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({}),
}))
vi.mock('#/lib/auth-client', () => ({ authClient: {} }))

afterEach(cleanup)

const user = { name: 'Sam', email: 'sam@lab.test' }

function surface(over: Partial<Parameters<typeof AccessBlockedSurface>[0]>) {
  const onSignOut = vi.fn().mockResolvedValue(undefined)
  const onSwitch = vi.fn().mockResolvedValue(undefined)
  render(
    <AccessBlockedSurface
      user={user}
      suspendedWorkspace={null}
      contacts={[]}
      otherWorkspaces={[]}
      onSwitch={onSwitch}
      onSignOut={onSignOut}
      {...over}
    />,
  )
  return { onSignOut, onSwitch }
}

describe('AccessBlockedSurface', () => {
  it('names a suspension, who can reinstate, and offers sign-out', async () => {
    const { onSignOut } = surface({
      suspendedWorkspace: { name: 'Acme Lab' },
      contacts: [
        { name: 'Olive Owner', email: 'olive@lab.test', role: 'owner' },
      ],
    })
    expect(
      screen.getByRole('heading', {
        name: 'Your access to Acme Lab is suspended',
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'olive@lab.test' }).getAttribute('href'),
    ).toBe('mailto:olive@lab.test')
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(onSignOut).toHaveBeenCalled())
  })

  it('says a person with no membership is not in any workspace', () => {
    surface({})
    expect(
      screen.getByRole('heading', {
        name: 'You aren’t a member of any workspace',
      }),
    ).toBeTruthy()
  })

  it('lets a suspended person open a workspace they still belong to', async () => {
    const { onSwitch } = surface({
      suspendedWorkspace: { name: 'Acme Lab' },
      otherWorkspaces: [{ id: 'w2', name: 'Sam’s workspace' }],
    })
    await userEvent.click(
      screen.getByRole('button', { name: 'Sam’s workspace' }),
    )
    expect(onSwitch).toHaveBeenCalledWith('w2')
  })
})

describe('pickActiveMembership', () => {
  const m = (workspaceId: string, suspendedAt: Date | null) => ({
    workspaceId,
    suspendedAt,
  })
  it('skips a suspended preferred workspace for a live one', () => {
    const picked = pickActiveMembership([m('a', new Date()), m('b', null)], 'a')
    expect(picked?.workspaceId).toBe('b')
  })
  it('returns the suspended membership only when nothing else exists', () => {
    expect(
      pickActiveMembership([m('a', new Date())], 'a')?.suspendedAt,
    ).toBeTruthy()
    expect(pickActiveMembership([], 'a')).toBeNull()
  })
})
