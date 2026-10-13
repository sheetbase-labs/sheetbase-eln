import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Scope } from '#/lib/api-credential-scopes'

import { Route } from './api'

/**
 * SET-01 — the API and SDK page. A revoke or rotate that the server refuses
 * must say so: the token stays active, so a silent failure would leave the
 * reader believing the secret no longer works.
 */
const personal = vi.hoisted(() => ({
  createPersonalTokenFn: vi.fn(),
  listPersonalTokensFn: vi.fn(),
  personalTokenQueryKey: (userId: string, workspaceId: string) => [
    'personal-tokens',
    userId,
    workspaceId,
  ],
  revokePersonalTokenFn: vi.fn(),
  rotatePersonalTokenFn: vi.fn(),
}))
const credentials = vi.hoisted(() => ({
  apiCredentialQueryKey: (workspaceId: string) => [
    'api-credentials',
    workspaceId,
  ],
  createApiCredentialFn: vi.fn(),
  listApiCredentialsFn: vi.fn(),
  revokeApiCredentialFn: vi.fn(),
  rotateApiCredentialFn: vi.fn(),
}))

vi.mock('#/lib/personal-api-tokens', () => personal)
vi.mock('#/lib/api-credential-admin', () => credentials)
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'gareth' },
        workspace: { id: 'ws', role: 'owner' },
      },
    }),
  }),
}))

const PERSONAL_TOKEN = {
  id: 'tok-1',
  workspaceId: 'ws',
  displayPrefix: 'sbp_1',
  name: 'Local Jupyter',
  scopes: ['projects:read'] as Scope[],
  createdAt: '2026-09-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  createdByUserId: 'gareth',
}

const SERVICE_CREDENTIAL = {
  id: 'cred-1',
  workspaceId: 'ws',
  kind: 'service' as const,
  displayPrefix: 'sbs_1',
  name: 'Nightly import',
  scopes: ['projects:read'] as Scope[],
  createdAt: '2026-09-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  createdByUserId: 'gareth',
}

afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
})

function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('API settings component required')
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
      <Component />
    </QueryClientProvider>,
  )
}

describe('API and SDK settings', () => {
  it('reports a refused personal-token revoke', async () => {
    personal.listPersonalTokensFn.mockResolvedValue([PERSONAL_TOKEN])
    credentials.listApiCredentialsFn.mockResolvedValue([])
    personal.revokePersonalTokenFn.mockRejectedValue(
      new Error('Revoking that token is not allowed.'),
    )
    const user = userEvent.setup()
    renderRoute()

    const table = await screen.findByRole('table', {
      name: 'Personal tokens',
    })
    await user.click(within(table).getByRole('button', { name: 'Revoke' }))
    await user.click(screen.getByRole('button', { name: 'Revoke token' }))

    await waitFor(() =>
      expect(
        screen.getByText('Revoking that token is not allowed.'),
      ).toBeTruthy(),
    )
  })

  it('reports a refused service-credential rotate', async () => {
    personal.listPersonalTokensFn.mockResolvedValue([])
    credentials.listApiCredentialsFn.mockResolvedValue([SERVICE_CREDENTIAL])
    credentials.rotateApiCredentialFn.mockRejectedValue(
      new Error('Only an owner may rotate this credential.'),
    )
    const user = userEvent.setup()
    renderRoute()

    const table = await screen.findByRole('table', {
      name: 'Workspace service credentials',
    })
    await user.click(within(table).getByRole('button', { name: 'Rotate' }))
    await user.click(screen.getByRole('button', { name: 'Rotate credential' }))

    await waitFor(() =>
      expect(
        screen.getByText('Only an owner may rotate this credential.'),
      ).toBeTruthy(),
    )
  })
})
