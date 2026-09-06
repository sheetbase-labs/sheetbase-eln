/** ADMIN-02 — external-access overview tests. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { AdminExternalAccess } from './admin-external-access'
import type * as WorkspaceAdmin from '#/lib/workspace-admin'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: ReactNode
  } & Record<string, unknown>) => <a {...props}>{children}</a>,
}))

vi.mock('#/lib/data-client', () => ({
  createDataClient: () => ({}),
}))

const mocks = vi.hoisted(() => ({
  fetchMembers: vi.fn(),
  listCredentials: vi.fn(),
  revokeCredential: vi.fn(),
  rotateCredential: vi.fn(),
  fetchConnectorDiagnostics: vi.fn(),
  updateConnector: vi.fn(),
  listWebhookSubs: vi.fn(),
  fetchWebhookHealth: vi.fn(),
  setWebhookStatus: vi.fn(),
  listExtensions: vi.fn(),
  enableExtension: vi.fn(),
  disableExtension: vi.fn(),
}))

vi.mock('#/lib/workspace-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceAdmin>()
  return {
    ...actual,
    fetchWorkspaceMembers: mocks.fetchMembers,
  }
})

vi.mock('#/lib/api-credential-admin', () => ({
  apiCredentialQueryKey: (workspaceId: string) => [
    'admin-001',
    'api-credentials',
    workspaceId,
  ],
  listApiCredentialsFn: mocks.listCredentials,
  revokeApiCredentialFn: mocks.revokeCredential,
  rotateApiCredentialFn: mocks.rotateCredential,
}))

vi.mock('#/lib/admin-platform', () => ({
  fetchConnectorDiagnosticsFn: mocks.fetchConnectorDiagnostics,
}))

vi.mock('#/lib/webhook-admin', () => ({
  describeWebhookAdminError: (cause: unknown) =>
    cause instanceof Error ? cause.message : 'webhook error',
  fetchWebhookHealthFn: mocks.fetchWebhookHealth,
  listWebhookSubscriptionsFn: mocks.listWebhookSubs,
  setWebhookSubscriptionStatusFn: mocks.setWebhookStatus,
  webhookAdminKeys: {
    subscriptions: (workspaceId: string) => ['wh-subs', workspaceId],
    health: (workspaceId: string) => ['wh-health', workspaceId],
  },
}))

vi.mock('#/lib/connectors/client', () => ({
  connectorQueryKeys: { connectors: ['connectors'] },
  describeConnectorsError: (cause: unknown) =>
    cause instanceof Error ? cause.message : 'connector error',
  updateConnector: mocks.updateConnector,
}))

vi.mock('#/lib/extensions/client', () => ({
  describeExtensionsError: (cause: unknown) =>
    cause instanceof Error ? cause.message : 'extension error',
  disableExtension: mocks.disableExtension,
  enableExtension: mocks.enableExtension,
  extensionQueryKeys: { extensions: ['extensions'] },
  listExtensions: mocks.listExtensions,
}))

function member(id: string, role: string, suspended: boolean) {
  return {
    id: `m-${id}`,
    workspaceId: 'ws-1',
    userId: id,
    role,
    suspendedAt: suspended ? '2026-09-01T10:00:00.000Z' : null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  }
}

function setup(role: string, memberCount = 2) {
  mocks.fetchMembers.mockResolvedValue(
    Array.from({ length: memberCount }, (_, index) =>
      member(`user-${index}`, index === 0 ? 'owner' : 'member', false),
    ),
  )
  mocks.listCredentials.mockResolvedValue([
    {
      id: 'cred-1',
      workspaceId: 'ws-1',
      kind: 'service',
      displayPrefix: 'abcd1234',
      name: 'CI pipeline',
      scopes: ['projects:read'],
      createdAt: '2026-08-01T10:00:00.000Z',
      lastUsedAt: '2026-09-05T10:00:00.000Z',
      revokedAt: null,
      expiresAt: null,
      createdByUserId: 'user-0',
    },
  ])
  mocks.fetchConnectorDiagnostics.mockResolvedValue({
    activeConnectors: 1,
    pausedConnectors: 0,
    recentFailures: 0,
    missingSecrets: 0,
    repeatedFailures: 0,
    connectors: [
      {
        id: 'conn-1',
        name: 'LIMS feed',
        connectorType: 'instrument',
        status: 'active',
        lastRunStatus: 'succeeded',
        lastRunAt: '2026-09-05T10:00:00.000Z',
        lastErrorCode: null,
        hasSecrets: true,
        recentFailureCount: 0,
      },
    ],
  })
  mocks.listWebhookSubs.mockResolvedValue([
    {
      id: 'sub-1',
      key: 'orders',
      url: 'https://example.com/orders',
      description: null,
      eventTypes: [],
      status: 'active',
      maxRetries: 5,
      failureThreshold: 10,
      consecutiveFailures: 0,
      rateLimitPerMinute: null,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    },
  ])
  mocks.fetchWebhookHealth.mockResolvedValue({
    generatedAt: '2026-09-06T10:00:00.000Z',
    data: [
      {
        subscriptionId: 'sub-1',
        key: 'orders',
        url: 'https://example.com/orders',
        status: 'active',
        consecutiveFailures: 0,
        failureThreshold: 10,
        maxRetries: 5,
        rateLimitPerMinute: null,
        total24h: 10,
        delivered24h: 10,
        failed24h: 0,
        deadLetter24h: 0,
        retrying24h: 0,
        pending24h: 0,
        successRate24h: 1,
        lastDeliveredAt: '2026-09-05T10:00:00.000Z',
        oldestPendingAt: null,
        lastError: null,
      },
    ],
  })
  mocks.listExtensions.mockResolvedValue([
    {
      id: 'ext-1',
      workspace_id: 'ws-1',
      key: 'labels',
      name: 'Label printer',
      version: '1.2.0',
      source: 'https://example.com/ext.tgz',
      manifest: {},
      status: 'enabled',
      credential_id: null,
      created_at: '2026-08-01T10:00:00.000Z',
      updated_at: '2026-09-01T10:00:00.000Z',
    },
  ])
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AdminExternalAccess workspaceId="ws-1" role={role} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminExternalAccess', () => {
  it('shows every externally-acting domain to owners with lifecycle metadata', async () => {
    setup('owner')
    expect(await screen.findByText('Members and roles')).toBeTruthy()
    expect(await screen.findByText('Service credentials')).toBeTruthy()
    expect(await screen.findByText('Connectors')).toBeTruthy()
    expect(await screen.findByText('Webhooks')).toBeTruthy()
    expect(await screen.findByText('Extensions')).toBeTruthy()
    // Lifecycle / status metadata from the source tables.
    expect(await screen.findByText('CI pipeline')).toBeTruthy()
    expect(await screen.findByText('LIMS feed')).toBeTruthy()
    expect(await screen.findByText('100.0% (10/10)')).toBeTruthy()
    expect(await screen.findByText('Label printer')).toBeTruthy()
    // Canonical-section and audit links per panel.
    expect(screen.getAllByText('Review').length).toBe(5)
    expect(screen.getAllByText('Audit trail').length).toBe(5)
  })

  it('hides owner-only panels from non-owner admins', async () => {
    setup('admin')
    expect(await screen.findByText('Connectors')).toBeTruthy()
    expect(await screen.findByText('Webhooks')).toBeTruthy()
    expect(await screen.findByText('Extensions')).toBeTruthy()
    expect(screen.queryByText('Members and roles')).toBeNull()
    expect(screen.queryByText('Service credentials')).toBeNull()
  })
  it('wires credential rotate/revoke through the canonical owner operations', async () => {
    const user = userEvent.setup()
    setup('owner')
    await screen.findByText('CI pipeline')
    await user.click(screen.getByRole('button', { name: 'Rotate' }))
    expect(mocks.rotateCredential).toHaveBeenCalledWith({
      data: { workspaceId: 'ws-1', credentialId: 'cred-1' },
    })
    await user.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(mocks.revokeCredential).toHaveBeenCalledWith({
      data: { workspaceId: 'ws-1', credentialId: 'cred-1' },
    })
  })

  it('wires connector, webhook and extension disable through canonical operations', async () => {
    const user = userEvent.setup()
    setup('owner')
    await screen.findByText('LIMS feed')
    const disableButtons = screen.getAllByRole('button', { name: 'Disable' })
    expect(disableButtons).toHaveLength(3)
    await user.click(disableButtons[0])
    expect(mocks.updateConnector).toHaveBeenCalledWith(
      {},
      { workspaceId: 'ws-1', connectorId: 'conn-1', status: 'paused' },
    )
    await user.click(disableButtons[1])
    expect(mocks.setWebhookStatus).toHaveBeenCalledWith({
      data: {
        workspaceId: 'ws-1',
        subscriptionId: 'sub-1',
        status: 'disabled',
      },
    })
    await user.click(disableButtons[2])
    expect(mocks.disableExtension).toHaveBeenCalledWith(
      {},
      { workspaceId: 'ws-1', extensionId: 'ext-1' },
    )
  })


  it('limits stewards to the integration domains', async () => {
    setup('steward')
    expect(await screen.findByText('Connectors')).toBeTruthy()
    expect(await screen.findByText('Webhooks')).toBeTruthy()
    expect(await screen.findByText('Extensions')).toBeTruthy()
    expect(screen.queryByText('Members and roles')).toBeNull()
    expect(screen.queryByText('Service credentials')).toBeNull()
    expect(mocks.fetchMembers).not.toHaveBeenCalled()
    expect(mocks.listCredentials).not.toHaveBeenCalled()
  })

  it('fail-closes viewers with no panels', async () => {
    setup('viewer')
    expect(
      await screen.findByText(/require an administration capability/),
    ).toBeTruthy()
    expect(screen.queryByText('Members and roles')).toBeNull()
    expect(mocks.fetchMembers).not.toHaveBeenCalled()
    expect(mocks.listExtensions).not.toHaveBeenCalled()
  })

  it('defers to the canonical section past the row limit', async () => {
    setup('owner', 9)
    expect(await screen.findByText(/\+1 more in/)).toBeTruthy()
  })
})
