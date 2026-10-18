import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcceptInvitationSurface, Route } from './accept-invitation'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ options }),
  redirect: (value: unknown) => value,
  useRouter: () => ({}),
}))

afterEach(cleanup)

function surface(
  accept: (token: string, userId: string) => Promise<void>,
  onDone = vi.fn(),
  token: string = 'tok',
) {
  render(
    <AcceptInvitationSurface
      token={token}
      userId="u1"
      userEmail="a@b.test"
      accept={accept}
      onDone={onDone}
    />,
  )
  return onDone
}

describe('/accept-invitation', () => {
  it('keeps the invitation link through sign-in when signed out', async () => {
    await expect(
      Route.options.beforeLoad?.({
        context: { auth: null },
        location: { href: '/accept-invitation?token=abc' },
      } as never),
    ).rejects.toMatchObject({
      to: '/sign-in',
      search: { next: '/accept-invitation?token=abc' },
    })
  })

  it('redeems the token for the signed-in user and moves on', async () => {
    const accept = vi.fn().mockResolvedValue(undefined)
    const onDone = surface(accept)
    await userEvent.click(
      screen.getByRole('button', { name: 'Accept invitation' }),
    )
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(accept).toHaveBeenCalledWith('tok', 'u1')
  })

  it('says why a refused invitation failed and what to do', async () => {
    const accept = vi.fn().mockRejectedValue(new Error('boom'))
    const onDone = surface(accept)
    await userEvent.click(
      screen.getByRole('button', { name: 'Accept invitation' }),
    )
    expect(await screen.findByText(/send a new link/)).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('explains a link with no token', () => {
    surface(vi.fn(), vi.fn(), '')
    expect(screen.getByText('This link has no invitation in it.')).toBeTruthy()
  })
})
