/**
 * SET-02.3 audit log as a datagrid: the read is a keyset cursor over
 * `api.audit_events` that the grid extends as the user scrolls, the search and
 * operation filter are server reads (the grid never filters rows it holds), and
 * the export states that it covers every matching entry rather than the loaded
 * window. Loading, empty, exhausted and failed states are all stated.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as auditHistory from '#/lib/audit-history'
import type { AuditEventWire, AuditEventsPageWire } from '#/lib/audit-history'
import { BLOB_URL_LIFETIME_MS } from '#/lib/download'

import { Route } from './audit'

const mocks = vi.hoisted(() => ({
  events: vi.fn(),
  all: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  urlSearch: { value: {} },
}))

vi.mock('#/components/v3/ui/sonner', () => ({ toast: mocks.toast }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useSearch: () => mocks.urlSearch.value,
    useNavigate: () => mocks.navigate,
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

vi.mock('#/lib/audit-history', async (importOriginal) => {
  const actual = await importOriginal<typeof auditHistory>()
  return {
    ...actual,
    fetchAuditEvents: mocks.events,
    fetchAllAuditEvents: mocks.all,
  }
})

const Audit = Route.options.component as React.ComponentType

function event(overrides: Partial<AuditEventWire> = {}): AuditEventWire {
  return {
    sequence: 41,
    id: 'ev-1',
    createdAt: '2026-10-01T09:00:00.000000Z',
    entityType: 'record',
    entityUuid: '00000000-0000-4000-8000-000000000001',
    operation: 'update',
    recordId: null,
    projectId: null,
    actorUserId: null,
    actorName: null,
    actorCredentialId: null,
    clientId: null,
    payload: {},
    ...overrides,
  }
}

function page(
  overrides: Partial<AuditEventsPageWire> = {},
): AuditEventsPageWire {
  return {
    formatVersion: 1,
    events: [],
    hasMore: false,
    nextCursor: null,
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

function searchBox() {
  return screen.getByLabelText('Search audit log')
}

function scrollPane() {
  return screen.getByTestId('audit-scroll')
}

/** The filter the Nth audit read was issued with. */
function filterOf(call: number) {
  return mocks.events.mock.calls[call]?.[1] as Record<string, unknown>
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('audit log filters by record and day', () => {
  it('reads only the entries of the record and days the URL names', async () => {
    mocks.urlSearch.value = {
      record: '00000000-0000-4000-8000-0000000000aa',
      from: '2026-09-01',
      to: '2026-09-30',
    }
    mocks.events.mockResolvedValue(page({ events: [event()] }))
    renderAudit()
    await screen.findByText('2026-10-01 09:00:00')
    expect(filterOf(0)).toMatchObject({
      object: '00000000-0000-4000-8000-0000000000aa',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-30T23:59:59.999Z',
    })
    expect(
      screen.getByRole('button', { name: 'Clear the record filter' }),
    ).toBeTruthy()
    mocks.urlSearch.value = {}
  })

  it('writes a typed day into the URL', async () => {
    mocks.events.mockResolvedValue(page({ events: [event()] }))
    renderAudit()
    await screen.findByText('2026-10-01 09:00:00')
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-09-01' },
    })
    const call = mocks.navigate.mock.calls[0][0] as {
      search: (s: Record<string, unknown>) => Record<string, unknown>
    }
    expect(call.search({ record: 'r' })).toEqual({
      record: 'r',
      from: '2026-09-01',
    })
  })
})

describe('audit log grid', () => {
  it('sends the typed search to the server instead of filtering the loaded rows', async () => {
    // The returned event does not match the term the user typed: a grid that
    // filtered locally would hide it, a server-filtered grid renders what the
    // read returned.
    mocks.events.mockResolvedValue(
      page({ events: [event({ operation: 'update' })] }),
    )
    renderAudit()
    await screen.findByText('2026-10-01 09:00:00')

    fireEvent.change(searchBox(), { target: { value: 'quarantine' } })

    await waitFor(() => expect(mocks.events).toHaveBeenCalledTimes(2))
    expect(filterOf(1)).toMatchObject({ search: 'quarantine' })
    expect(screen.getByText('2026-10-01 09:00:00')).toBeTruthy()
  })

  it('sends the operation filter to the server', async () => {
    mocks.events.mockResolvedValue(
      page({ events: [event({ operation: 'update' })] }),
    )
    renderAudit()
    await screen.findByText('2026-10-01 09:00:00')

    fireEvent.change(screen.getByLabelText('Operation'), {
      target: { value: 'quarantine' },
    })

    await waitFor(() =>
      expect(filterOf(1)).toMatchObject({ operation: 'quarantine' }),
    )
  })

  it('walks the cursor to older entries on scroll and says when the log ends', async () => {
    mocks.events
      .mockResolvedValueOnce(
        page({
          events: [event({ id: 'newer', sequence: 12 })],
          hasMore: true,
          nextCursor: 12,
        }),
      )
      .mockResolvedValueOnce(
        page({
          events: [
            event({
              id: 'older',
              sequence: 7,
              createdAt: '2026-09-01T09:00:00.000000Z',
            }),
          ],
          hasMore: false,
          nextCursor: 7,
        }),
      )
    renderAudit()
    await screen.findByText('2026-10-01 09:00:00')
    // The tail is the shared control now: a landmark and a real button, so the
    // rest of the log is reachable without scrolling — which is the only way it
    // was reachable before.
    const tail = screen.getByRole('navigation', {
      name: 'Older audit entries',
    })
    expect(tail).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy()
    expect(screen.queryByText('2026-09-01 09:00:00')).toBeNull()

    fireEvent.scroll(scrollPane())

    await screen.findByText('2026-09-01 09:00:00')
    expect(mocks.events.mock.calls[1][1]).toMatchObject({
      beforeSequence: 12,
    })
    expect(
      await screen.findByText(
        'End of the log — every matching entry is loaded.',
      ),
    ).toBeTruthy()
    // Older entries are appended, never replacing the first page.
    expect(screen.getByText('2026-10-01 09:00:00')).toBeTruthy()
  })

  it('shows a body state row while the log is loading', async () => {
    // The project's lib target predates Promise.withResolvers, so the pending
    // read is held open with the constructor instead.
    mocks.events.mockReturnValue(new Promise<AuditEventsPageWire>(() => {}))
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
    mocks.events.mockResolvedValue(page())
    renderAudit()

    expect(await screen.findByText(/No audit entries match/)).toBeTruthy()
  })

  it('reports a failed read rather than an empty log, and retries on request', async () => {
    mocks.events
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page({ events: [event()] }))
    renderAudit()

    expect(
      await screen.findByText('The audit log could not be read.'),
    ).toBeTruthy()
    expect(screen.queryByText(/No audit entries match/)).toBeNull()

    screen.getByRole('button', { name: 'Retry' }).click()

    await screen.findByText('2026-10-01 09:00:00')
    expect(mocks.events).toHaveBeenCalledTimes(2)
  })

  it('states a failed page of older entries and retries it rather than spinning', async () => {
    mocks.events
      .mockResolvedValueOnce(
        page({
          events: [event({ id: 'newer', sequence: 12 })],
          hasMore: true,
          nextCursor: 12,
        }),
      )
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(
        page({
          events: [
            event({
              id: 'older',
              sequence: 7,
              createdAt: '2026-09-01T09:00:00.000000Z',
            }),
          ],
        }),
      )
    renderAudit()
    await screen.findByText('2026-10-01 09:00:00')

    fireEvent.scroll(scrollPane())

    expect(
      await screen.findByText('Older entries could not be loaded.'),
    ).toBeTruthy()
    // A failed page is never left as a spinner that cannot end.
    expect(screen.queryByText('Loading older entries…')).toBeNull()

    screen.getByRole('button', { name: 'Retry' }).click()

    await screen.findByText('2026-09-01 09:00:00')
    expect(mocks.events).toHaveBeenCalledTimes(3)
  })

  it('exports every entry matching the search, keeps the anchor attached, and holds the blob URL past the click', async () => {
    mocks.events.mockResolvedValue(page({ events: [event()] }))
    mocks.all.mockResolvedValue([
      event(),
      event({
        id: 'ev-2',
        sequence: 40,
        createdAt: '2026-09-30T09:00:00.000000Z',
      }),
    ])
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    const blobs: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:audit-export'
    })
    URL.revokeObjectURL = vi.fn()
    let attachedWhenClicked = false
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        attachedWhenClicked = document.body.contains(this)
      })
    const timer = vi.spyOn(window, 'setTimeout')
    try {
      renderAudit()
      await screen.findByText('2026-10-01 09:00:00')
      screen
        .getByRole<HTMLButtonElement>('button', {
          name: 'Export CSV of all matches',
        })
        .click()

      // The export reads the whole selection — both entries, not just the row
      // the grid has loaded.
      await waitFor(() => expect(mocks.all).toHaveBeenCalledTimes(1))
      expect(mocks.all.mock.calls[0][1]).toEqual({
        operation: undefined,
        search: undefined,
      })
      await waitFor(() => expect(blobs).toHaveLength(1))
      const csv = await blobs[0].text()
      expect(csv.split('\n')).toHaveLength(3)
      expect(csv).toContain('"41"')

      // A detached anchor is ignored by Firefox, and revoking the URL in the
      // click's own tick can land before the browser has read the blob, which
      // drops the file with nothing said. The release is deferred to the shared
      // helper's timer instead.
      expect(attachedWhenClicked).toBe(true)
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      expect(timer).toHaveBeenCalledWith(
        expect.any(Function),
        BLOB_URL_LIFETIME_MS,
      )

      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          'audit-log.csv exported',
          expect.objectContaining({
            description: '2 entries — every entry matching the current search.',
          }),
        ),
      )
    } finally {
      anchorClick.mockRestore()
      timer.mockRestore()
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it('states a download the browser cannot take', async () => {
    mocks.events.mockResolvedValue(page({ events: [event()] }))
    mocks.all.mockResolvedValue([event()])
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
          name: 'Export CSV of all matches',
        })
        .click()

      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          'Could not export the audit log',
          expect.objectContaining({
            description: 'This browser cannot save files.',
          }),
        ),
      )
    } finally {
      if (download) {
        Object.defineProperty(HTMLAnchorElement.prototype, 'download', download)
      }
    }
  })
})
