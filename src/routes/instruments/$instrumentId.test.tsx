/**
 * LAB-06.2/LAB-06.3 — the instrument record page is where a qualification is
 * seen, granted and revoked, because the booking path refuses an unqualified
 * booker. Granting and revoking are workspace-owner actions, and recording a
 * calibration needs the workspace writer the RPC requires.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './$instrumentId'

const InstrumentPage = Route.options.component as React.ComponentType

const dataClient = vi.hoisted(() => ({
  list: vi.fn<() => Promise<unknown[]>>(async () => []),
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

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ instrumentId: 'inst-1' }),
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
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
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
        intakeMethod: 'none',
        position: 1,
        updatedAt: '2026-10-01T00:00:00Z',
      },
      isLoading: false,
      isSuccess: true,
    }),
    useInstrumentRuns: () => ({ data: [], isSuccess: true }),
    useInstrumentCalibrations: () => ({ data: [], isSuccess: true }),
    useInstrumentParsers: () => ({ data: [], isSuccess: true }),
    useInstrumentLastImport: () => ({ data: null, isSuccess: true }),
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
  dataClient.list.mockResolvedValue([{ user_id: 'u-2' }])
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
    expect(screen.getByText('2027-10-11')).toBeTruthy()
    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.getByText('cell culture only')).toBeTruthy()
    expect(dataClient.rpc).toHaveBeenCalledWith('instrument_qualification_list', {
      p_instrument_id: 'inst-1',
    })
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
    expect(screen.queryByRole('button', { name: 'Record calibration' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Grant qualification' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(screen.getByText(/A workspace owner grants/)).toBeTruthy()
  })
})
