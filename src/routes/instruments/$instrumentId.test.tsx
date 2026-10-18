/**
 * LAB-06.2/LAB-06.3 — the instrument record page is where a qualification is
 * seen, granted and revoked, because the booking path refuses an unqualified
 * booker. Granting and revoking are workspace-owner actions, and recording a
 * calibration needs the workspace writer the RPC requires.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$instrumentId'

const InstrumentPage = Route.options.component as React.ComponentType

const dataClient = vi.hoisted(() => ({
  list: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  rpc: vi.fn<(name: string) => Promise<unknown>>(async () => ({})),
}))

const role = vi.hoisted(() => ({ current: 'owner' }))

const qualifications = vi.hoisted(() => ({
  current: [
    {
      user_id: 'u-1',
      user_name: 'Priya Raman',
      valid_until: '2027-10-11T12:01:47.526Z',
      current: true,
      qualified_for: 'cell culture only',
    },
  ],
}))

const calibrations = vi.hoisted(() => ({ current: [] as unknown[] }))
const intake = vi.hoisted(() => ({
  method: 'none',
  parsers: [] as unknown[],
  lastImport: null as null | { status: string; createdAt: string },
}))
const search = vi.hoisted(() => ({ current: {} }))

// jsdom reports no layout, so the grid's virtualiser would render no rows: give
// every element the viewport a browser would report for the list area.
for (const prop of ['offsetHeight', 'clientHeight'] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => 600,
  })
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ instrumentId: 'inst-1' }),
    useSearch: () => search.current,
    useRouteContext: () => ({
      context: {
        workspace: { id: 'ws-1', role: role.current },
        user: { id: 'u-0', name: 'Gareth P.' },
      },
    }),
    fullPath: '/instruments/$instrumentId',
    options: config,
  }),
  Outlet: () => null,
  redirect: (options: unknown) => options,
  useNavigate: () => vi.fn(),
  Link: ({
    to,
    search,
    children,
  }: {
    to?: unknown
    search?: Record<string, unknown>
    children?: React.ReactNode
  }) => {
    // The href is what the page hands the browser, search included: a Book
    // action that dropped the instrument would render the same href as a link
    // that never carried it.
    const path = typeof to === 'string' ? to : '#'
    const query = new URLSearchParams(
      Object.entries(search ?? {})
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, String(value)]),
    ).toString()
    return <a href={query ? `${path}?${query}` : path}>{children}</a>
  },
}))

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  notebookDataClient: dataClient,
}))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({
    names: {},
    userLabel: (userId: string) => userId,
  }),
}))

vi.mock(
  '#/components/v3/instruments/instruments-data',
  async (importOriginal) => ({
    ...(await importOriginal()),
    useInstrument: () => ({
      data: {
        id: 'inst-1',
        displayId: 'INS-0042',
        name: 'Ambr 250',
        instrumentType: 'bioreactor',
        model: null,
        serialNumber: null,
        vendor: null,
        location: 'Lab 2',
        ownerId: null,
        retiredAt: null,
        intakeMethod: intake.method,
        position: 1,
        updatedAt: '2026-10-01T00:00:00Z',
      },
      isLoading: false,
      isSuccess: true,
    }),
    useInstrumentRuns: () => ({ data: [], isSuccess: true }),
    useInstrumentCalibrations: () => ({
      data: calibrations.current,
      isSuccess: true,
    }),
    useInstrumentParsers: () => ({ data: intake.parsers, isSuccess: true }),
    useInstrumentLastImport: () => ({
      data: intake.lastImport,
      isSuccess: true,
    }),
    useInstrumentNextBooking: () => ({
      data: { bookable: true, next: null },
      isSuccess: true,
    }),
  }),
)

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <InstrumentPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  role.current = 'owner'
  calibrations.current = []
  search.current = {}
  intake.method = 'none'
  intake.parsers = []
  intake.lastImport = null
  dataClient.list.mockImplementation(async (...args: unknown[]) =>
    String(args[0]) === 'projects'
      ? [{ id: 'p-1', title: 'Process development' }]
      : [{ user_id: 'u-2' }],
  )
  dataClient.rpc.mockImplementation((name: string) => {
    if (name === 'instrument_qualification_list')
      return Promise.resolve(qualifications.current)
    return Promise.resolve({})
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('instrument qualification', () => {
  it('shows who is qualified, until when, and the instrument scope', async () => {
    renderPage()

    expect(await screen.findByText('Priya Raman')).toBeTruthy()
    expect(screen.getByText('11 Oct 2027')).toBeTruthy()
    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.getByText('cell culture only')).toBeTruthy()
    expect(dataClient.rpc).toHaveBeenCalledWith(
      'instrument_qualification_list',
      {
        p_instrument_id: 'inst-1',
      },
    )
  })

  it('revokes a qualification only after the confirmation', async () => {
    const user = userEvent.setup()
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    expect(dataClient.rpc).not.toHaveBeenCalledWith(
      'revoke_instrument_qualification',
      expect.anything(),
    )

    await user.click(
      await screen.findByRole('button', { name: 'Revoke qualification' }),
    )
    await waitFor(() =>
      expect(dataClient.rpc).toHaveBeenCalledWith(
        'revoke_instrument_qualification',
        { p_instrument_id: 'inst-1', p_user_id: 'u-1' },
      ),
    )
  })

  it('grants a qualification with an expiry the server will accept', async () => {
    const user = userEvent.setup()
    renderPage()

    fireEvent.click(
      await screen.findByRole('button', { name: 'Grant qualification' }),
    )
    fireEvent.change(screen.getByLabelText(/^Person/), {
      target: { value: 'u-2' },
    })
    fireEvent.change(screen.getByLabelText(/^Valid until/), {
      target: { value: '2027-01-31' },
    })
    fireEvent.change(screen.getByLabelText(/^Qualified for/), {
      target: { value: 'pH probes only' },
    })
    await user.click(
      screen.getByRole('button', { name: 'Grant qualification' }),
    )

    await waitFor(() =>
      expect(dataClient.rpc).toHaveBeenCalledWith(
        'set_instrument_qualification',
        expect.objectContaining({
          p_instrument_id: 'inst-1',
          p_user_id: 'u-2',
          p_valid_until: '2027-01-31T00:00:00.000Z',
          p_qualified_for: 'pH probes only',
        }),
      ),
    )
  })

  it('offers no calibration or qualification action to a read-only role', async () => {
    role.current = 'viewer'
    renderPage()

    await screen.findByText('Priya Raman')
    expect(
      screen.queryByRole('button', { name: 'Record calibration' }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Grant qualification' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(screen.getByText(/A workspace owner grants/)).toBeTruthy()
  })
})

describe('instrument record actions and dates', () => {
  it('offers Book and carries this instrument to the Schedule', async () => {
    renderPage()

    const book = await screen.findByRole('link', { name: 'Book' })
    expect(book.getAttribute('href')).toBe('/schedule?book=inst-1')
  })

  it('writes calibration days as dates, not raw ISO', async () => {
    calibrations.current = [
      {
        id: 'cal-1',
        instrumentId: 'inst-1',
        performedAt: '2026-09-11T00:00:00.000Z',
        dueAt: '2027-04-09T00:00:00.000Z',
        certificateFileId: null,
        performedByUserId: null,
        notes: null,
      },
    ]
    renderPage()

    // Once in the Calibration summary and once in the history table below it.
    expect(await screen.findByText('Last performed')).toBeTruthy()
    expect(screen.getAllByText('11 Sep 2026').length).toBe(2)
    expect(screen.getAllByText('9 Apr 2027').length).toBe(2)
    expect(screen.queryByText('2026-09-11')).toBeNull()
  })
})

describe('J-INS-10 overdue calibration and its certificate', () => {
  const OVERDUE = {
    id: 'cal-1',
    instrumentId: 'inst-1',
    performedAt: '2025-01-01T00:00:00.000Z',
    dueAt: '2025-07-01T00:00:00.000Z',
    certificateFileId: null,
    performedByUserId: null,
    notes: null,
  }

  it('shows the overdue notice on the record page with the step that clears it', async () => {
    calibrations.current = [OVERDUE]
    renderPage()

    await screen.findByText('Calibration overdue.')
    // One in the header and one in the notice.
    expect(
      screen.getAllByRole('button', { name: 'Record calibration' }).length,
    ).toBe(2)
  })

  it('names who can record it when the viewer cannot', async () => {
    role.current = 'viewer'
    calibrations.current = [OVERDUE]
    renderPage()

    await screen.findByText('Calibration overdue.')
    expect(screen.getByText(/any role except viewer/)).toBeTruthy()
  })

  it('opens the record dialog from the registry deep link', async () => {
    search.current = { record: '1' }
    renderPage()

    expect(await screen.findByText('Certificate project')).toBeTruthy()
    expect(
      await screen.findByLabelText('Calibration certificate', {
        selector: 'input',
      }),
    ).toBeTruthy()
  })

  it('uploads the certificate and passes its file id to the calibration', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('upload-authorize')
        ? new Response(
            JSON.stringify({ fileRecordId: 'rec-1', fileObjectId: 'fo-9' }),
            { status: 201 },
          )
        : new Response('{}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      search.current = { record: '1' }
      renderPage()

      const input = await screen.findByLabelText('Calibration certificate', {
        selector: 'input',
      })
      await user.upload(
        input,
        new File(['%PDF'], 'cert.pdf', { type: 'application/pdf' }),
      )
      await screen.findByText('Certificate: cert.pdf')
      const buttons = screen.getAllByRole('button', {
        name: 'Record calibration',
      })
      await user.click(buttons[buttons.length - 1])

      await waitFor(() =>
        expect(dataClient.rpc).toHaveBeenCalledWith(
          'record_instrument_calibration',
          expect.objectContaining({ p_certificate_file_id: 'fo-9' }),
        ),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('J-INS-09 an automated instrument that is not delivering', () => {
  function automated(lastImport: { status: string; createdAt: string } | null) {
    intake.method = 'filedrop'
    intake.parsers = [{ id: 'p1', name: 'Plate export', validated: true }]
    intake.lastImport = lastImport
  }

  it('turns "Last import failed" into a retry through the import page for this instrument', async () => {
    automated({ status: 'failed', createdAt: new Date().toISOString() })
    renderPage()

    await screen.findByText('The last import failed.')
    expect(
      screen.getByRole('link', { name: 'Upload a file' }).getAttribute('href'),
    ).toBe('/import?instrument=inst-1')
  })

  it('tells a first-time instrument how data is supposed to arrive', async () => {
    automated(null)
    renderPage()

    expect(await screen.findByText('Waiting for first data.')).toBeTruthy()
    expect(screen.getByText(/uploads one of its exports/)).toBeTruthy()
  })

  it('names who can upload when the viewer cannot', async () => {
    role.current = 'viewer'
    automated(null)
    renderPage()

    await screen.findByText('Waiting for first data.')
    expect(screen.queryByRole('link', { name: 'Upload a file' })).toBeNull()
    expect(screen.getByText(/any role except viewer/)).toBeTruthy()
  })
})
