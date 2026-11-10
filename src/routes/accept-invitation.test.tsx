import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AcceptInvitationSurface, Route } from './accept-invitation'

// oxlint-disable-next-line anti-slop/no-module-mocking -- The route module builds its route object from createFileRoute at import time; the test drives that route's beforeLoad and the surface it returns, which needs the framework's factories replaced.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <TOptions,>(options: TOptions) => ({ options }),
  redirect: <TValue,>(value: TValue) => value,
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
    // SAFETY: this route's beforeLoad reads only `context.auth` and
    // `location`; the remaining router arguments are supplied by the framework
    // and are not reachable without rendering the whole router.
    const routerArgs = {
      context: { auth: null },
      location: { href: '/accept-invitation?token=abc' },
    } as never

    await expect(Route.options.beforeLoad?.(routerArgs)).rejects.toMatchObject({
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
