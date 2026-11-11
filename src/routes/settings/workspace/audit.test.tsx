/**
 * SET-02.3 audit log as a datagrid: the read is a keyset cursor over
 * `api.audit_events` that the grid extends as the user scrolls, the search and
 * operation filter are server reads (the grid never filters rows it holds), and
 * the export states that it covers every matching entry rather than the loaded
 * window. Loading, empty, exhausted and failed states are all stated.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { z } from 'zod'

import type { AuditEventWire, AuditEventsPageWire } from '#/lib/audit-history'
import { BLOB_URL_LIFETIME_MS } from '#/lib/download'
import { Toaster, toast } from '#/components/ui/sonner'

const requestSchema = z.object({
  p_entity_type: z.string().nullable(),
  p_operation: z.string().nullable(),
  p_actor_user_id: z.string().nullable(),
  p_from: z.string().nullable(),
  p_to: z.string().nullable(),
  p_search: z.string().nullable(),
  p_object: z.string().nullable(),
  p_before_sequence: z.number().nullable(),
  p_limit: z.number(),
  p_project_id: z.string().nullable(),
})

const reads = vi.fn<() => Promise<AuditEventsPageWire>>()
const exports = vi.fn<() => Promise<AuditEventsPageWire>>()
const requests: Array<z.infer<typeof requestSchema>> = []

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (url.pathname.endsWith('/audit_events')) {
    const request = requestSchema.parse(await new Response(init?.body).json())
    requests.push(request)

    return Response.json(await (request.p_limit === 200 ? exports() : reads()))
  }

  return Response.json([])
})

const { Route } = await import('./audit')
const { dropSharedReads } = await import('#/lib/data-client')

function renderAudit(search = '') {
  const Component = Route.options.component

  if (!Component) throw new Error('Audit component required')

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const root = createRootRoute({
    beforeLoad: () => ({
      context: {
        user: { id: 'admin', name: 'Admin', email: 'admin@sheetbase.test' },
        workspace: { id: 'ws-1', name: 'Process Development', role: 'owner' },
      },
    }),
  })

  const route = createRoute({
    getParentRoute: () => root,
    path: '/settings/workspace/audit',
    validateSearch: Route.options.validateSearch,
    component: Component,
  })

  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/settings/workspace/audit' + search],
    }),
  })

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )

  return router
}

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

function searchBox() {
  return screen.getByLabelText('Search audit log')
}

function scrollPane() {
  return screen.getByTestId('audit-scroll')
}

/** The filter the Nth audit read was issued with. */
function filterOf(call: number) {
  return requests.filter((request) => request.p_limit === 50)[call]
}

afterEach(() => {
  cleanup()
  toast.dismiss()
  dropSharedReads()
})

beforeEach(() => {
  requests.length = 0
  reads.mockReset()
  exports.mockReset()
})

afterAll(() => vi.unstubAllGlobals())

describe('audit log filters by record and day', () => {
  it('reads only the entries of the record and days the URL names', async () => {
    reads.mockResolvedValue(page({ events: [event()] }))
    renderAudit(
      '?record=00000000-0000-4000-8000-0000000000aa&from=2026-09-01&to=2026-09-30',
    )
    await screen.findByText('1 Oct 2026, 09:00')
    expect(filterOf(0)).toMatchObject({
      p_object: '00000000-0000-4000-8000-0000000000aa',
      p_from: '2026-09-01T00:00:00.000Z',
      p_to: '2026-09-30T23:59:59.999Z',
    })
    expect(
      screen.getByRole('button', { name: 'Clear the record filter' }),
    ).toBeTruthy()
  })

  it('writes a day picked from the calendar into the URL', async () => {
    reads.mockResolvedValue(page({ events: [event()] }))
    const router = renderAudit('?record=r')
    await screen.findByText('1 Oct 2026, 09:00')
    fireEvent.click(screen.getByRole('button', { name: 'From' }))
    // The calendar opens on the current month; any day-of-month 1 will do.
    const [first] = await screen.findAllByRole('button', { name: /\b1st,/ })

    fireEvent.click(first)

    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        record: 'r',
        from: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      }),
    )
  })
})

describe('audit log grid', () => {
  it('sends the typed search to the server instead of filtering the loaded rows', async () => {
    // The returned event does not match the term the user typed: a grid that
    // filtered locally would hide it, a server-filtered grid renders what the
    // read returned.
    reads.mockResolvedValue(page({ events: [event({ operation: 'update' })] }))
    renderAudit()
    await screen.findByText('1 Oct 2026, 09:00')

    fireEvent.change(searchBox(), { target: { value: 'quarantine' } })

    await waitFor(() => expect(reads).toHaveBeenCalledTimes(2))
    expect(filterOf(1)).toMatchObject({ p_search: 'quarantine' })
    expect(screen.getByText('1 Oct 2026, 09:00')).toBeTruthy()
  })

  it('sends the operation filter to the server', async () => {
    reads.mockResolvedValue(page({ events: [event({ operation: 'update' })] }))
    renderAudit()
    await screen.findByText('1 Oct 2026, 09:00')

    fireEvent.change(screen.getByLabelText('Operation'), {
      target: { value: 'quarantine' },
    })

    await waitFor(() =>
      expect(filterOf(1)).toMatchObject({ p_operation: 'quarantine' }),
    )
  })

  it('walks the cursor to older entries on scroll and says when the log ends', async () => {
    reads
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
    await screen.findByText('1 Oct 2026, 09:00')

    // The tail is the shared control now: a landmark and a real button, so the
    // rest of the log is reachable without scrolling — which is the only way it
    // was reachable before.
    const tail = screen.getByRole('navigation', {
      name: 'Older audit entries',
    })

    expect(tail).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy()
    expect(screen.queryByText('1 Sep 2026, 09:00')).toBeNull()

    fireEvent.scroll(scrollPane())

    await screen.findByText('1 Sep 2026, 09:00')
    expect(filterOf(1)).toMatchObject({
      p_before_sequence: 12,
    })
    expect(
      await screen.findByText(
        'End of the log — every matching entry is loaded.',
      ),
    ).toBeTruthy()
    // Older entries are appended, never replacing the first page.
    expect(screen.getByText('1 Oct 2026, 09:00')).toBeTruthy()
  })

  it('shows a body state row while the log is loading', async () => {
    // The project's lib target predates Promise.withResolvers, so the pending
    // read is held open with the constructor instead.
    reads.mockReturnValue(new Promise<AuditEventsPageWire>(() => {}))
    renderAudit()

    // While the log is being read the grid shows a status row, so it is never
    // a header-only shell and never claims there is nothing to show.
    await screen.findByRole('table', { name: 'Audit log' })
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText(/No audit entries match/)).toBeNull()
  })

  it('keeps the empty copy for a loaded log with no matches', async () => {
    reads.mockResolvedValue(page())
    renderAudit()

    expect(await screen.findByText(/No audit entries match/)).toBeTruthy()
  })

  it('reports a failed read rather than an empty log, and retries on request', async () => {
    reads
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page({ events: [event()] }))
    renderAudit()

    expect(
      await screen.findByText('The audit log couldn’t be read.'),
    ).toBeTruthy()
    expect(screen.queryByText(/No audit entries match/)).toBeNull()

    screen.getByRole('button', { name: 'Try again' }).click()

    await screen.findByText('1 Oct 2026, 09:00')
    expect(reads).toHaveBeenCalledTimes(2)
  })

  it('states a failed page of older entries and retries it rather than spinning', async () => {
    reads
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
    await screen.findByText('1 Oct 2026, 09:00')

    fireEvent.scroll(scrollPane())

    expect(
      await screen.findByText('Older entries couldn’t be loaded.'),
    ).toBeTruthy()
    // A failed page is never left as a spinner that cannot end.
    expect(screen.queryByText('Loading older entries…')).toBeNull()

    screen.getByRole('button', { name: 'Try again' }).click()

    await screen.findByText('1 Sep 2026, 09:00')
    expect(reads).toHaveBeenCalledTimes(3)
  })

  it('exports every entry matching the search, keeps the anchor attached, and holds the blob URL past the click', async () => {
    reads.mockResolvedValue(page({ events: [event()] }))
    exports.mockResolvedValue(
      page({
        events: [
          event(),
          event({
            id: 'ev-2',
            sequence: 40,
            createdAt: '2026-09-30T09:00:00.000000Z',
          }),
        ],
      }),
    )

    const originalCreate = Object.getOwnPropertyDescriptor(
      URL,
      'createObjectURL',
    )

    const originalRevoke = Object.getOwnPropertyDescriptor(
      URL,
      'revokeObjectURL',
    )

    const blobs: Blob[] = []

    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)

      return 'blob:audit-export'
    })

    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    let attachedWhenClicked = false

    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        attachedWhenClicked = document.body.contains(this)
      })

    const timer = vi.spyOn(window, 'setTimeout')

    try {
      renderAudit()
      await screen.findByText('1 Oct 2026, 09:00')
      screen
        .getByRole<HTMLButtonElement>('button', {
          name: 'Export CSV of all matches',
        })
        .click()

      // The export reads the whole selection — both entries, not just the row
      // the grid has loaded.
      await waitFor(() => expect(exports).toHaveBeenCalledTimes(1))
      expect(requests.find((request) => request.p_limit === 200)).toMatchObject(
        {
          p_operation: null,
          p_search: null,
        },
      )
      await waitFor(() => expect(blobs).toHaveLength(1))
      const [blob] = blobs

      const csv = await blob.text()
      expect(csv.split('\n')).toHaveLength(3)
      expect(csv).toContain('"41"')

      // A detached anchor is ignored by Firefox, and revoking the URL in the
      // click's own tick can land before the browser has read the blob, which
      // drops the file with nothing said. The release is deferred to the shared
      // helper's timer instead.
      expect(attachedWhenClicked).toBe(true)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).not.toHaveBeenCalled()
      expect(timer).toHaveBeenCalledWith(
        expect.any(Function),
        BLOB_URL_LIFETIME_MS,
      )

      expect(await screen.findByText('audit-log.csv exported')).toBeTruthy()
      expect(
        screen.getByText(
          '2 entries — every entry matching the current search.',
        ),
      ).toBeTruthy()
    } finally {
      anchorClick.mockRestore()
      timer.mockRestore()

      if (originalCreate)
        Object.defineProperty(URL, 'createObjectURL', originalCreate)
      else Reflect.deleteProperty(URL, 'createObjectURL')

      if (originalRevoke)
        Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
      else Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('states a download the browser cannot take', async () => {
    reads.mockResolvedValue(page({ events: [event()] }))
    exports.mockResolvedValue(page({ events: [event()] }))

    const download = Object.getOwnPropertyDescriptor(
      HTMLAnchorElement.prototype,
      'download',
    )

    // Without the download attribute the click navigates to the blob instead
    // of saving it, so the export has to say so rather than go quiet.
    Reflect.deleteProperty(HTMLAnchorElement.prototype, 'download')

    try {
      renderAudit()
      await screen.findByText('1 Oct 2026, 09:00')
      screen
        .getByRole<HTMLButtonElement>('button', {
          name: 'Export CSV of all matches',
        })
        .click()

      expect(
        await screen.findByText('Couldn’t export the audit log'),
      ).toBeTruthy()
      expect(screen.getByText('This browser cannot save files.')).toBeTruthy()
    } finally {
      if (download) {
        Object.defineProperty(HTMLAnchorElement.prototype, 'download', download)
      }
    }
  })
})
