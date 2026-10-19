import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './clients'

const mocks = vi.hoisted(() => ({
  role: 'owner',
  list: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
  toast: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'admin', name: 'Admin', email: 'admin@sheetbase.test' },
        workspace: { id: 'ws', name: 'Workspace', role: mocks.role },
      },
    }),
  }),
  Link: ({
    to,
    children,
    ...props
  }: {
    to?: string
    children?: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(mocks.toast, { error: mocks.toast }),
}))
vi.mock('#/lib/data-client', () => ({
  createDataClient: () => ({
    list: mocks.list,
    rpc: mocks.rpc,
    insert: mocks.insert,
  }),
}))
vi.mock('#/components/v3/settings/workspace-admins-line', () => ({
  WorkspaceAdminsLine: () => null,
}))

const Clients = Route.options.component as React.ComponentType

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Clients />
    </QueryClientProvider>,
  )
}

function answer(resource: string): unknown[] {
  if (resource === 'clients')
    return [{ id: 'c1', code: 'CL-001', name: 'Acme Biologics' }]
  if (resource === 'client_portal_shares')
    return [
      {
        id: 's1',
        client_id: 'c1',
        record_id: 'r1',
        shared_at: '2026-10-19T09:00:00Z',
      },
    ]
  if (resource === 'records')
    return [
      {
        id: 'r1',
        identifier: 'EXP-1',
        title: 'Shared run',
        kind: 'experiment',
        status: 'approved',
      },
      {
        id: 'r2',
        identifier: 'EXP-2',
        title: 'Offered run',
        kind: 'experiment',
        status: 'approved',
      },
    ]
  return []
}

afterEach(() => {
  cleanup()
  mocks.role = 'owner'
  mocks.list.mockReset()
  mocks.rpc.mockReset()
  mocks.insert.mockReset()
  mocks.toast.mockReset()
})

describe('settings clients', () => {
  it('keeps the page to workspace admins', () => {
    mocks.role = 'member'
    renderPage()
    expect(
      screen.getByText('Only workspace admins manage clients'),
    ).toBeTruthy()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('lists what is shared and offers only records not yet shared', async () => {
    mocks.list.mockImplementation(async (resource: string) => answer(resource))
    renderPage()
    expect(await screen.findByText('Shared run')).toBeTruthy()
    expect(
      screen.getByRole('option', { name: 'EXP-2 · Offered run' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('option', { name: 'EXP-1 · Shared run' }),
    ).toBeNull()
  })

  it('shares the chosen record', async () => {
    mocks.list.mockImplementation(async (resource: string) => answer(resource))
    mocks.rpc.mockResolvedValue({})
    renderPage()
    await screen.findByText('Shared run')
    fireEvent.change(screen.getByDisplayValue('Choose a record'), {
      target: { value: 'r2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await vi.waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('share_record_with_client', {
        p_client_id: 'c1',
        p_record_id: 'r2',
      }),
    )
  })

  it('previews the client portal', async () => {
    mocks.list.mockImplementation(async (resource: string) => answer(resource))
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'client_portal_preview_records'
        ? [
            {
              record_id: 'r1',
              identifier: 'EXP-1',
              title: 'Shared run',
              kind: 'experiment',
              status: 'approved',
              project_id: 'p1',
              shared_at: '2026-10-19T09:00:00Z',
              approved_at: '2026-10-19T09:30:00Z',
              approved_by_name: 'Ada Admin',
            },
          ]
        : [],
    )
    renderPage()
    await screen.findByText('Shared run')
    fireEvent.click(screen.getByRole('button', { name: 'Preview as client' }))
    expect(await screen.findByText(/Approved .* by Ada Admin/)).toBeTruthy()
    expect(
      screen.getByText('No project shares automatically with this client.'),
    ).toBeTruthy()
  })
})
