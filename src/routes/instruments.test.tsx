import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  InstrumentInspector,
  RegisterInstrument,
  calibrationState,
} from './instruments'
import type { InstrumentRow } from '#/components/v3/instruments/instruments-data'
import type * as router from '@tanstack/react-router'

// The register dialog writes through the canonical RPC and the inspector reads through the data
// client; mock only those, so the tests observe what the screen asks for.
const { rpc, list } = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    // The href is what the registry hands the browser, so the mock keeps the
    // search: a Book action that dropped the instrument would render the same
    // href as one that never carried it.
    Link: ({
      to,
      children,
      search,
    }: {
      to?: unknown
      children?: React.ReactNode
      search?: Record<string, unknown>
    }) => {
      const path = typeof to === 'string' ? to : '#'
      const query = new URLSearchParams(
        Object.entries(search ?? {})
          .filter(([, value]) => value != null)
          .map(([key, value]) => [key, String(value)]),
      ).toString()
      return <a href={query ? `${path}?${query}` : path}>{children}</a>
    },
  }
})

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: { rpc, list },
}))

afterEach(() => {
  cleanup()
  rpc.mockReset()
  list.mockReset()
})

const INSTRUMENT: InstrumentRow = {
  id: 'ins-1',
  displayId: 'INS-0007',
  name: 'Turbidimeter TB-02',
  instrumentType: 'qpcr',
  model: 'TB-2 v3',
  serialNumber: 'TB2-40917',
  vendor: 'Supplier H',
  location: 'Lab 2, bench 4',
  ownerId: 'user-1',
  retiredAt: null,
  intakeMethod: 'filedrop',
  position: 1,
  updatedAt: '2026-10-01T00:00:00.000Z',
}

const CALIBRATION = { state: 'ok' as const, label: '12 Feb 2027', tone: 'ok' }

function renderInspector(
  overrides: Partial<InstrumentRow> = {},
  canManage = true,
) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InstrumentInspector
        instrument={{ ...INSTRUMENT, ...overrides }}
        calibration={CALIBRATION}
        ownerLabel="Gareth P."
        canManage={canManage}
      />
    </QueryClientProvider>,
  )
}

function wireRows(byResource: Record<string, unknown[]>) {
  list.mockImplementation(
    async (resource: string) => byResource[resource] ?? [],
  )
}

/** The required fields the register dialog validates before it calls the RPC. */
async function fillInstrument(dialog: HTMLElement, user: UserEvent) {
  await user.type(within(dialog).getByLabelText(/Name/), 'Osmometer OS-02')
  await user.type(within(dialog).getByLabelText(/Model/), 'OsmoPRO Max')
  await user.type(within(dialog).getByLabelText(/Serial number/), 'OPM-1177')
  await user.type(within(dialog).getByLabelText(/Location/), 'Lab 2, bench 5')
}

describe('R5-CONFIG-02 register instrument', () => {
  it('offers the supported intake methods with what each one implies', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RegisterInstrument
          types={['qpcr']}
          workspaceId="ws-1"
          ownerId="user-1"
        />
      </QueryClientProvider>,
    )
    await user.click(
      screen.getByRole('button', { name: 'Register instrument' }),
    )
    const dialog = screen.getByRole('dialog')

    for (const title of [
      'File drop',
      'Webhook',
      'Manual entry',
      'Not connected yet',
    ]) {
      expect(within(dialog).getByText(title)).toBeTruthy()
    }
    expect(
      within(dialog).getAllByText(/Needs a validated parser/).length,
    ).toBeGreaterThan(0)
    expect(
      within(dialog).getByText(/Whoever enters a reading is its provenance/),
    ).toBeTruthy()
  })

  it('states the honest follow-up for a method that needs a validated parser', async () => {
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RegisterInstrument
          types={['qpcr']}
          workspaceId="ws-1"
          ownerId="user-1"
        />
      </QueryClientProvider>,
    )
    await user.click(
      screen.getByRole('button', { name: 'Register instrument' }),
    )
    const dialog = screen.getByRole('dialog')

    // File drop is the default: its data is held until a parser is validated.
    expect(
      within(dialog).getByText(/held until a validated parser is attached/),
    ).toBeTruthy()

    await user.click(within(dialog).getByText('Not connected yet'))
    await waitFor(() =>
      expect(
        within(dialog).getByText(/can be booked and cited right away/),
      ).toBeTruthy(),
    )
  })

  it('registers the chosen method through the canonical RPC', async () => {
    const user = userEvent.setup()
    rpc.mockResolvedValue({
      id: 'ins-13',
      display_id: 'INS-0013',
      name: 'Osmometer OS-02',
      instrument_type: 'qpcr',
      model: 'OsmoPRO Max',
      serial_number: 'OPM-1177',
      vendor: null,
      location: 'Lab 2, bench 5',
      owner_id: 'user-1',
      retired_at: null,
      intake_method: 'webhook',
      position: 0,
      updated_at: '2026-10-11T00:00:00.000Z',
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RegisterInstrument
          types={['qpcr']}
          workspaceId="ws-1"
          ownerId="user-1"
        />
      </QueryClientProvider>,
    )
    await user.click(
      screen.getByRole('button', { name: 'Register instrument' }),
    )
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Name/), 'Osmometer OS-02')
    await user.type(within(dialog).getByLabelText(/Model/), 'OsmoPRO Max')
    await user.type(within(dialog).getByLabelText(/Serial number/), 'OPM-1177')
    await user.type(within(dialog).getByLabelText(/Location/), 'Lab 2, bench 5')
    await user.click(within(dialog).getByText('Webhook'))
    await user.click(
      within(dialog).getByRole('button', { name: 'Register instrument' }),
    )

    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith(
      'create_instrument',
      expect.objectContaining({
        p_intake_method: 'webhook',
        p_name: 'Osmometer OS-02',
      }),
    )
  })

  it('reports a refusal that is not about the serial number at the form, not on the field', async () => {
    const user = userEvent.setup()
    rpc.mockRejectedValue(new Error('permission denied for workspace ws-1'))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RegisterInstrument
          types={['qpcr']}
          workspaceId="ws-1"
          ownerId="user-1"
        />
      </QueryClientProvider>,
    )
    await user.click(
      screen.getByRole('button', { name: 'Register instrument' }),
    )
    const dialog = screen.getByRole('dialog')
    await fillInstrument(dialog, user)
    await user.click(
      within(dialog).getByRole('button', { name: 'Register instrument' }),
    )

    expect(
      await within(dialog).findByText('Could not register the instrument.'),
    ).toBeTruthy()
    // The serial number is valid, so it is not blamed for a workspace refusal.
    expect(
      within(dialog).getByLabelText(/Serial number/).getAttribute('aria-invalid'),
    ).toBeNull()
  })

  it('keeps a duplicate serial number on the serial field', async () => {
    const user = userEvent.setup()
    rpc.mockRejectedValue(
      new Error('duplicate key value violates unique constraint on serial'),
    )
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RegisterInstrument
          types={['qpcr']}
          workspaceId="ws-1"
          ownerId="user-1"
        />
      </QueryClientProvider>,
    )
    await user.click(
      screen.getByRole('button', { name: 'Register instrument' }),
    )
    const dialog = screen.getByRole('dialog')
    await fillInstrument(dialog, user)
    await user.click(
      within(dialog).getByRole('button', { name: 'Register instrument' }),
    )

    expect(
      await within(dialog).findByText(
        'An instrument with this serial number is already registered.',
      ),
    ).toBeTruthy()
    expect(within(dialog).getByLabelText(/Serial number/).getAttribute('aria-invalid')).toBe(
      'true',
    )
  })
})

describe('R5-CONFIG-02 instrument inspector', () => {
  it('shows the method, per-method health, last data and next booking', async () => {
    wireRows({
      parsers: [{ id: 'parser-1', name: 'Turbidimeter v2' }],
      parser_versions: [{ parser_id: 'parser-1', status: 'validated' }],
      dataset_imports: [
        {
          instrument_id: 'ins-1',
          status: 'committed',
          created_at: '2026-10-05T09:12:00.000Z',
        },
      ],
      calendar_bookings: [
        {
          id: 'booking-1',
          title: 'Plate 4',
          starts_at: '2026-10-12T13:00:00.000Z',
        },
      ],
      instruments: [{ id: 'ins-1', retired_at: null }],
    })
    renderInspector()

    expect(await screen.findByText('Healthy')).toBeTruthy()
    expect(screen.getAllByText('File drop').length).toBeGreaterThan(0)
    expect(screen.getByText('2026-10-05 09:12')).toBeTruthy()
    expect(screen.getByText('2026-10-12 13:00 · Plate 4')).toBeTruthy()
    expect(screen.getByText('Turbidimeter v2 · validated')).toBeTruthy()
    expect(screen.queryByText('Parser not validated.')).toBeNull()
  })

  it('says a parser is not validated rather than showing health it cannot prove', async () => {
    wireRows({
      parsers: [{ id: 'parser-1', name: 'Turbidimeter v2' }],
      parser_versions: [],
      dataset_imports: [],
      // ADR-0054 — a retired instrument keeps its history but takes no booking.
      instruments: [{ id: 'ins-1', retired_at: '2026-09-01T00:00:00.000Z' }],
    })
    renderInspector()

    expect(await screen.findByText('Parser not validated')).toBeTruthy()
    expect(screen.getByText('Parser not validated.')).toBeTruthy()
    expect(screen.getByText('Nothing received')).toBeTruthy()
    expect(screen.getByText('Not bookable')).toBeTruthy()
  })

  it('reports manual and unconnected instruments as such, not as healthy', async () => {
    wireRows({ parsers: [], parser_versions: [], dataset_imports: [] })
    renderInspector({ intakeMethod: 'manual' })

    expect(await screen.findByText('Not used')).toBeTruthy()
    expect(screen.getAllByText('Manual entry').length).toBeGreaterThan(0)
    expect(
      screen.getByLabelText<HTMLSelectElement>('How data gets in').value,
    ).toBe('manual')
    // A method that cannot ingest keeps the data path out of the screen entirely.
    expect(screen.queryByText('Parser and imports')).toBeNull()
    expect(screen.queryByText('Parser not validated.')).toBeNull()
  })

  it('changes the method for a writer and says history is not rewritten', async () => {
    const user = userEvent.setup()
    wireRows({
      parsers: [],
      parser_versions: [],
      dataset_imports: [],
      instruments: [{ id: 'ins-1', retired_at: null }],
    })
    rpc.mockResolvedValue({
      id: 'ins-1',
      display_id: 'INS-0007',
      name: 'Turbidimeter TB-02',
      instrument_type: 'qpcr',
      model: 'TB-2 v3',
      serial_number: 'TB2-40917',
      vendor: 'Supplier H',
      location: 'Lab 2, bench 4',
      owner_id: 'user-1',
      retired_at: null,
      intake_method: 'manual',
      position: 1,
      updated_at: '2026-10-11T00:00:00.000Z',
    })
    renderInspector()

    expect(
      screen.getByText(/Imports already committed keep the parser and source/),
    ).toBeTruthy()
    await user.selectOptions(
      screen.getByLabelText('How data gets in'),
      'manual',
    )
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(rpc).toHaveBeenCalledWith('set_instrument_intake_method', {
      p_instrument_id: 'ins-1',
      p_intake_method: 'manual',
    })
  })

  it('offers no method control to a reader', async () => {
    wireRows({ parsers: [], parser_versions: [], dataset_imports: [] })
    renderInspector({ intakeMethod: 'none' }, false)
    expect(
      (await screen.findAllByText('Not connected')).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByLabelText('How data gets in')).toBeNull()
  })

  it('sends Book to the Schedule carrying this instrument, so its dialog opens on it', async () => {
    wireRows({
      parsers: [],
      parser_versions: [],
      dataset_imports: [],
      calendar_bookings: [],
      instruments: [{ id: 'ins-1', retired_at: null }],
    })
    renderInspector()

    const book = await screen.findByRole('link', { name: 'Book' })
    expect(book.getAttribute('href')).toBe('/schedule?book=ins-1')
  })

  it('offers no Book action for a retired instrument', async () => {
    wireRows({
      parsers: [],
      parser_versions: [],
      dataset_imports: [],
      instruments: [{ id: 'ins-1', retired_at: '2026-09-01T00:00:00.000Z' }],
    })
    renderInspector({ retiredAt: '2026-09-01T00:00:00.000Z' })

    expect(await screen.findByText('Not bookable')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Book' })).toBeNull()
  })
})

describe('R5-CONFIG-02 calibration due', () => {
  const now = new Date('2026-10-14T00:00:00.000Z')

  it('writes the due day the way the lab surfaces write dates, not as raw ISO', () => {
    expect(calibrationState('2027-04-09T00:00:00.000Z', now)).toEqual({
      state: 'ok',
      label: '9 Apr 2027',
      tone: 'ok',
    })
  })

  it('keeps the standing beside the day', () => {
    expect(calibrationState('2026-09-30T00:00:00.000Z', now).label).toBe(
      '30 Sep 2026 · 14 d overdue',
    )
    expect(calibrationState('2026-10-20T00:00:00.000Z', now).label).toBe(
      '20 Oct 2026 · due in 6 d',
    )
    expect(calibrationState(null, now)).toEqual({
      state: 'na',
      label: 'Not calibrated',
      tone: 'none',
    })
  })
})
