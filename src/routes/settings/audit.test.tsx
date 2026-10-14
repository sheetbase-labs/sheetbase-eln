/**
 * SET-02.3 audit log: the operation filter covers the log's vocabulary rather
 * than the current window, and a read that is still running (or has failed) is
 * stated instead of rendering an empty log.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as workspaceAdmin from '#/lib/workspace-admin'
import type { AuditEvent } from '#/lib/workspace-admin'

import { Route } from './audit'

const mocks = vi.hoisted(() => ({ activity: vi.fn(), toast: vi.fn() }))

vi.mock('#/components/v3/ui/sonner', () => ({ toast: mocks.toast }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'admin', name: 'Admin', email: 'admin@sheetbase.test' },
        workspace: { id: 'ws-1', name: 'Process Development', role: 'owner' },
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

vi.mock('#/lib/data-client', () => ({ createDataClient: () => ({}) }))

vi.mock('#/lib/workspace-admin', async (importOriginal) => {
  const actual = await importOriginal<typeof workspaceAdmin>()
  return { ...actual, fetchWorkspaceActivity: mocks.activity }
})

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))

const Audit = Route.options.component as React.ComponentType

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'ev-1',
    workspaceId: 'ws-1',
    sequence: 41,
    entityType: 'record',
    entityUuid: null,
    operation: 'update',
    recordId: null,
    projectId: null,
    actorUserId: null,
    clientId: null,
    payload: {},
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  }
}

function renderAudit() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Audit />
    </QueryClientProvider>,
  )
}

function operationValues(): string[] {
  const select = screen.getByLabelText('Operation')
  return [...select.querySelectorAll('option')].map((option) => option.value)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('audit log', () => {
  it('offers an operation the recent window does not contain', async () => {
    mocks.activity.mockResolvedValue([event({ operation: 'update' })])
    renderAudit()

    await screen.findByText('2026-10-01 09:00:00')
    const values = operationValues()
    expect(values).toContain('update')
    // No `amend` event is loaded, but the filter can still select it.
    expect(values).toContain('amend')
    expect(values).toContain('revoke')
  })

  it('shows a body state row while the log is loading', async () => {
    // The project's lib target predates Promise.withResolvers, so the pending
    // read is held open with the constructor instead.
    mocks.activity.mockReturnValue(new Promise<AuditEvent[]>(() => {}))
    renderAudit()

    const table = await screen.findByRole('table', { name: 'Audit log' })
    // While the log is being read the body carries a state row, so the table is
    // never a header-only shell and never claims there is nothing to show.
    expect(
      table.querySelectorAll('tbody [data-slot="table-state-row"]').length,
    ).toBe(1)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(/No audit entries match/)).toBeNull()
  })

  it('keeps the empty copy for a loaded log with no matches', async () => {
    mocks.activity.mockResolvedValue([])
    renderAudit()

    expect(await screen.findByText(/No audit entries match/)).toBeTruthy()
  })

  it('reports a failed read rather than an empty log', async () => {
    mocks.activity.mockRejectedValue(new Error('offline'))
    renderAudit()

    expect(
      await screen.findByText('The audit log could not be read.'),
    ).toBeTruthy()
    expect(screen.queryByText(/No audit entries match/)).toBeNull()
  })

  it('holds the download blob URL open past the click, with the anchor in the document', async () => {
    mocks.activity.mockResolvedValue([event()])
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:audit-export')
    URL.revokeObjectURL = vi.fn()
    let attachedWhenClicked = false
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        attachedWhenClicked = document.body.contains(this)
      })
    try {
      renderAudit()
      await screen.findByText('2026-10-01 09:00:00')
      const button = screen.getByRole<HTMLButtonElement>('button', {
        name: 'Export CSV of shown rows',
      })
      vi.useFakeTimers()
      button.click()

      // A detached anchor is ignored by Firefox, and revoking the URL in the
      // click's own tick can land before the browser has read the blob, which
      // drops the file with nothing said.
      expect(attachedWhenClicked).toBe(true)
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()

      vi.advanceTimersByTime(60_000)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:audit-export')
    } finally {
      vi.useRealTimers()
      anchorClick.mockRestore()
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it('states a download the browser cannot take', async () => {
    mocks.activity.mockResolvedValue([event()])
    const download = Object.getOwnPropertyDescriptor(
      HTMLAnchorElement.prototype,
      'download',
    )
    // Without the download attribute the click navigates to the blob instead
    // of saving it, so the export has to say so rather than go quiet.
    delete (HTMLAnchorElement.prototype as Partial<HTMLAnchorElement>).download
    try {
      renderAudit()
      await screen.findByText('2026-10-01 09:00:00')
      screen
        .getByRole<HTMLButtonElement>('button', {
          name: 'Export CSV of shown rows',
        })
        .click()

      expect(mocks.toast).toHaveBeenCalledWith(
        'Could not export the audit log',
        expect.objectContaining({
          description: 'This browser cannot save files.',
        }),
      )
    } finally {
      if (download) {
        Object.defineProperty(
          HTMLAnchorElement.prototype,
          'download',
          download,
        )
      }
    }
  })
})
