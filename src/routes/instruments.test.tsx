import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
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
import { z } from 'zod'

import { InstrumentInspector, RegisterInstrument } from './instruments'
import { calibrationState } from '#/components/instruments/calibration-standing'
import type { InstrumentRow } from '#/components/instruments/instruments-data'
import { dropSharedReads } from '#/lib/data-client'

/** One call the app made through the `/api/db` transport. */
interface TransportCall {
  path: string
  method: string
  body: string | null
}

/** A refusal the transport answers with, in PostgREST's own error shape. */
interface TransportFailure {
  status: number
  body: { code: string; message: string }
}

/** What the fake transport answers with, and what the app asked it for. */
interface TransportState {
  calls: TransportCall[]
  /** Rows per `/api/db` resource, in the app's own wire shape. */
  rows: Record<string, unknown[]>
  /** Reply per RPC name, as PostgREST would return it. */
  rpc: Record<string, z.core.util.JSONType>
  failure: TransportFailure | null
}

/**
 * The one boundary these cases fake: the same-origin `/api/db` transport, the
 * real data client's only dependency on the network. It is installed before the
 * modules that capture `fetch` are imported, so every screen here talks to the
 * real client, its error parsing and its query cache.
 */
const transport = vi.hoisted(() => {
  const state: TransportState = {
    calls: [],
    rows: {},
    rpc: {},
    failure: null,
  }

  // Pin "now" so intake health does not go stale as real days pass: the
  // fixture's last import is 2026-10-05 and health turns stale after 30 days.
  vi.stubEnv('SHEETBASE_ENV', 'test')
  vi.stubEnv('SHEETBASE_NOW', '2026-10-10T12:00:00.000Z')

  globalThis.fetch = async (input, init) => {
    const url = new URL(
      z
        .union([z.string(), z.instanceof(URL), z.instanceof(Request)])
        .transform((value) => {
          if (value instanceof URL) return value.toString()

          if (value instanceof Request) return value.url

          return value
        })
        .parse(input),
      'http://localhost',
    )

    const sent = z.string().safeParse(init?.body ?? null)

    state.calls.push({
      path: `${url.pathname}${url.search}`,
      method: init?.method ?? 'GET',
      body: sent.success ? sent.data : null,
    })

    if (state.failure) {
      return new Response(JSON.stringify(state.failure.body), {
        status: state.failure.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/db/rpc/')) {
      const name = url.pathname.slice('/api/db/rpc/'.length)

      return new Response(JSON.stringify(state.rpc[name] ?? null), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const resource = url.pathname.slice('/api/db/'.length)
    const rows = state.rows[resource] ?? []

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Range':
          rows.length === 0 ? '*/0' : `0-${rows.length - 1}/${rows.length}`,
      },
    })
  }

  return state
})

/** Every request the app made, newest last. */
function requestsTo(path: string): TransportCall[] {
  return transport.calls.filter((call) => call.path.startsWith(path))
}

afterEach(() => {
  cleanup()
  // The client shares reads for a second: two cases wire different rows for
  // the same table, so each must start from an empty cache.
  dropSharedReads()
  transport.calls.length = 0
  transport.rows = {}
  transport.rpc = {}
  transport.failure = null
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

/**
 * Render in a real router: the register dialog navigates and the inspector
 * links, so both need the route context the app supplies. The initial match is
 * loaded before the first paint, so each case can assert synchronously.
 */
async function renderInRouter(ui: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> })

  const instrumentRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/instruments/$instrumentId',
    component: () => null,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([instrumentRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  await router.load()

  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )

  return { view, router }
}

async function renderInspector(
  overrides: Partial<InstrumentRow> = {},
  canManage = true,
  canEditParsers = true,
) {
  return renderInRouter(
    <InstrumentInspector
      instrument={{ ...INSTRUMENT, ...overrides }}
      calibration={CALIBRATION}
      ownerLabel="Gareth P."
      canManage={canManage}
      canEditParsers={canEditParsers}
    />,
  )
}

function wireRows(byResource: Record<string, unknown[]>) {
  transport.rows = { ...byResource }
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
    await renderInRouter(
      <RegisterInstrument
        types={['qpcr']}
        workspaceId="ws-1"
        ownerId="user-1"
      />,
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
    await renderInRouter(
      <RegisterInstrument
        types={['qpcr']}
        workspaceId="ws-1"
        ownerId="user-1"
      />,
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
    transport.rpc['create_instrument'] = {
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
    }

    const { router } = await renderInRouter(
      <RegisterInstrument
        types={['qpcr']}
        workspaceId="ws-1"
        ownerId="user-1"
      />,
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

    await waitFor(() =>
      expect(requestsTo('/api/db/rpc/create_instrument')).toHaveLength(1),
    )
    expect(
      JSON.parse(requestsTo('/api/db/rpc/create_instrument')[0].body ?? '{}'),
    ).toMatchObject({
      p_intake_method: 'webhook',
      p_name: 'Osmometer OS-02',
    })
    // Registering lands on the new instrument, not back on the list.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/instruments/ins-13'),
    )
  })

  it('reports a refusal that is not about the serial number at the form, not on the field', async () => {
    const user = userEvent.setup()
    transport.failure = {
      status: 403,
      body: { code: '42501', message: 'permission denied for workspace ws-1' },
    }
    await renderInRouter(
      <RegisterInstrument
        types={['qpcr']}
        workspaceId="ws-1"
        ownerId="user-1"
      />,
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
      await within(dialog).findByText('Couldn’t register the instrument.'),
    ).toBeTruthy()
    // The serial number is valid, so it is not blamed for a workspace refusal.
    expect(
      within(dialog)
        .getByLabelText(/Serial number/)
        .getAttribute('aria-invalid'),
    ).toBeNull()
  })

  it('keeps a duplicate serial number on the serial field', async () => {
    const user = userEvent.setup()
    transport.failure = {
      status: 409,
      body: {
        code: '23505',
        message: 'duplicate key value violates unique constraint on serial',
      },
    }
    await renderInRouter(
      <RegisterInstrument
        types={['qpcr']}
        workspaceId="ws-1"
        ownerId="user-1"
      />,
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
    expect(
      within(dialog)
        .getByLabelText(/Serial number/)
        .getAttribute('aria-invalid'),
    ).toBe('true')
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
    await renderInspector()

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
    await renderInspector()

    expect(await screen.findByText('Parser not validated')).toBeTruthy()
    expect(screen.getByText('No parser yet')).toBeTruthy()
    expect(screen.getByText('Nothing received')).toBeTruthy()
    expect(screen.getByText('Not bookable')).toBeTruthy()
    // The warning carries the one step that fixes it, with the instrument already chosen.
    expect(
      screen.getByRole('button', { name: 'Add a parser' }).getAttribute('href'),
    ).toBe('/settings/lab/instruments?instrumentId=ins-1')
  })

  it('sends an untested draft to its own validation step', async () => {
    wireRows({
      parsers: [{ id: 'parser-1', name: 'Turbidimeter v2' }],
      parser_versions: [
        { id: 'ver-9', parser_id: 'parser-1', status: 'draft' },
      ],
    })
    await renderInspector()

    expect(await screen.findByText('Parser not validated.')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Validate the parser' })
        .getAttribute('href'),
    ).toBe('/settings/lab/instruments?instrumentId=ins-1&versionId=ver-9')
  })

  it('names a person, not a button, when the viewer cannot edit parsers', async () => {
    wireRows({ parsers: [], parser_versions: [] })
    await renderInspector({}, true, false)

    expect(await screen.findByText('No parser yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a parser' })).toBeNull()
    expect(screen.getByText(/Ask an admin or data steward/)).toBeTruthy()
  })

  it('reports manual and unconnected instruments as such, not as healthy', async () => {
    wireRows({ parsers: [], parser_versions: [], dataset_imports: [] })
    await renderInspector({ intakeMethod: 'manual' })

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
    transport.rpc['set_instrument_intake_method'] = {
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
    }
    await renderInspector()

    expect(screen.getByText(/Data already imported isn’t changed/)).toBeTruthy()
    await user.selectOptions(
      screen.getByLabelText('How data gets in'),
      'manual',
    )
    await waitFor(() =>
      expect(
        requestsTo('/api/db/rpc/set_instrument_intake_method'),
      ).toHaveLength(1),
    )
    expect(
      JSON.parse(
        requestsTo('/api/db/rpc/set_instrument_intake_method')[0].body ?? '{}',
      ),
    ).toMatchObject({
      p_instrument_id: 'ins-1',
      p_intake_method: 'manual',
    })
  })

  it('offers no method control to a reader', async () => {
    wireRows({ parsers: [], parser_versions: [], dataset_imports: [] })
    await renderInspector({ intakeMethod: 'none' }, false)
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
    await renderInspector()

    const book = await screen.findByRole('button', { name: 'Book' })
    expect(book.getAttribute('href')).toBe('/schedule?book=ins-1')
  })

  it('offers no Book action for a retired instrument', async () => {
    wireRows({
      parsers: [],
      parser_versions: [],
      dataset_imports: [],
      instruments: [{ id: 'ins-1', retired_at: '2026-09-01T00:00:00.000Z' }],
    })
    await renderInspector({ retiredAt: '2026-09-01T00:00:00.000Z' })

    expect(await screen.findByText('Not bookable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Book' })).toBeNull()
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
