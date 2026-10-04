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

import { DataClientError } from '#/lib/data-client'
import type { SampleEvent, SampleRecord } from '#/lib/samples'

import { Route } from './$sampleId'

const samples = vi.hoisted(() => ({
  fetchSample: vi.fn(),
  fetchSampleEvents: vi.fn(),
  consumeSample: vi.fn(),
  transferSample: vi.fn(),
  releaseSample: vi.fn(),
  quarantineSample: vi.fn(),
  disposeSample: vi.fn(),
  withdrawSample: vi.fn(),
  createSampleReservation: vi.fn(),
  cancelSampleReservation: vi.fn(),
  fetchSampleQuantityBalances: vi.fn(),
  fetchSampleDerivedSamples: vi.fn(),
  fetchSampleMeasurements: vi.fn(),
  fetchSampleReservations: vi.fn(),
}))
const sonner = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
const routeContext = vi.hoisted(() => ({
  value: {
    workspace: { role: 'scientist' },
  },
}))
const data = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ sampleId: 's-1' }),
    useRouteContext: () => ({ context: routeContext.value }),
    options: config,
  }),
  Outlet: () => null,
  redirect: (options: unknown) => options,
  Link: ({
    to,
    params,
    children,
    activeProps: _activeProps,
    activeOptions: _activeOptions,
    ...props
  }: {
    to?: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = typeof to === 'string' ? to : '#'
    if (params) {
      for (const [key, value] of Object.entries(params))
        href = href.replace(`$${key}`, encodeURIComponent(String(value)))
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: { list: data.list },
}))

vi.mock('#/lib/samples', () => ({
  ...samples,
  deriveSampleVolumeSummary: (
    record: { quantity: number | null; quantityUnit: string | null },
    events: Array<{
      operation: string
      quantityDelta: number | null
      quantityAfter: number | null
      quantityUnit: string | null
      createdAt: string
      purposeRecordId: string | null
    }>,
  ) => {
    const consumes = events.filter((e) => e.operation === 'consume')
    const used = consumes.length
      ? consumes.reduce((sum, e) => sum + Math.abs(e.quantityDelta ?? 0), 0)
      : null
    const creates = events.filter((e) => e.operation === 'create')
    const created = creates.at(-1)
    const latest = consumes.at(0)
    return {
      registered:
        created?.quantityAfter ??
        (record.quantity != null && used != null
          ? record.quantity + used
          : null),
      current: record.quantity,
      unit: record.quantityUnit,
      used,
      lastWithdrawal: latest
        ? {
            at: latest.createdAt,
            quantity: Math.abs(latest.quantityDelta ?? 0),
            unit: latest.quantityUnit,
            purposeRecordId: latest.purposeRecordId,
            remaining: latest.quantityAfter,
          }
        : null,
    }
  },
  sampleDerivedQueryKey: (recordId: string) => [
    'ui-port',
    'sample-derived',
    recordId,
  ],
  fetchSampleDerivedSamples: samples.fetchSampleDerivedSamples,
  fetchSampleMeasurements: samples.fetchSampleMeasurements,
  fetchSampleReservations: samples.fetchSampleReservations,
  sampleQueryKeys: {
    balances: (recordId: string) => [
      'reg-002',
      'samples',
      'balances',
      recordId,
    ],
    reservations: (recordId: string) => [
      'reg-002',
      'samples',
      'reservations',
      recordId,
    ],
  },
  describeSampleError: (error: unknown) =>
    error instanceof Error ? error.message : 'Could not complete it.',
}))

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({
    names: { 'u-9': 'Gareth P.' },
    userLabel: (id: string) => id,
  }),
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: sonner.toast,
  Toaster: () => null,
}))

const SampleRoute = Route.options.component as React.ComponentType

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: 's-1',
    projectId: null,
    kind: 'sample',
    identifier: 'SMP-2220',
    title: 'pAAV9-RC, lot P-117',
    status: 'available',
    tags: [],
    structureVersion: 1,
    metadataVersion: 7,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T11:20:00.000Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u-1',
    updatedByUserId: null,
    properties: {},
    customFields: {},
    lockedAt: null,
    lockedByRevisionId: null,
    sampleType: 'Plasmid',
    quantity: 12.5,
    quantityUnit: 'mg',
    storageLocation: 'F-3',
    barcode: null,
    lowStockThreshold: null,
    notes: null,
    holdCondition: null,
    holdStartedAt: null,
    holdDurationDays: null,
    holdUntil: null,
    allowedUseExperimentIds: null,
    quarantineReason: null,
    quarantinedAt: null,
    disposalReason: null,
    disposedAt: null,
    releasedAt: null,
    releaseChecks: null,
    ...overrides,
  }
}

function consumeEvent(): SampleEvent {
  return {
    id: 'e-1',
    recordId: 's-1',
    operation: 'consume',
    quantityDelta: -12.5,
    quantityBefore: 12.5,
    quantityAfter: 0,
    quantityUnit: 'mg',
    fromLocation: null,
    toLocation: null,
    actorUserId: 'u-9',
    purposeRecordId: null,
    notes: 'AEX resin screen',
    createdAt: '2026-09-11T10:40:00.000Z',
  }
}

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SampleRoute />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  routeContext.value = { workspace: { role: 'scientist' } }
  samples.fetchSampleEvents.mockResolvedValue([])
  samples.fetchSample.mockResolvedValue(sample())
  samples.releaseSample.mockResolvedValue(sample({ status: 'available' }))
  samples.disposeSample.mockResolvedValue(sample({ status: 'disposed' }))
  samples.consumeSample.mockResolvedValue(sample())
  samples.fetchSampleQuantityBalances.mockResolvedValue({
    sampleRecordId: 's-1',
    unit: 'mg',
    current: 12.5,
    used: 0,
    reserved: 0,
    free: 12.5,
  })
  samples.withdrawSample.mockResolvedValue({
    sample: sample(),
    derivedSampleId: null,
    derivedSample: null,
  })
  samples.createSampleReservation.mockResolvedValue({
    id: 'res-1',
    sampleRecordId: 's-1',
    experimentRecordId: 'exp-1',
    quantity: 2,
    unit: 'mg',
    planned: true,
    state: 'active',
    notes: null,
    createdByUserId: 'u-1',
    cancelledByUserId: null,
    cancelledAt: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
  })
  data.list.mockResolvedValue([
    { id: 'exp-1', identifier: 'EXP-0145', title: '50 L confirmation run' },
  ])
  samples.fetchSampleDerivedSamples.mockResolvedValue([])
  samples.fetchSampleMeasurements.mockResolvedValue([])
  samples.fetchSampleReservations.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('sample detail state banner', () => {
  it('shows the quarantine reason and offers release to an authorised role', async () => {
    samples.fetchSample.mockResolvedValue(
      sample({
        status: 'quarantined',
        quarantinedAt: '2026-09-16T11:20:00.000Z',
        quarantineReason: 'Endotoxin result pending from QC (EXP-0129)',
      }),
    )
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('In quarantine since 16 Sep 2026.')
    expect(screen.getByText(/Endotoxin result pending from QC/)).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'View release checks' })
        .getAttribute('href'),
    ).toBe('/samples/s-1/measurements')

    await user.click(screen.getByRole('button', { name: 'Release…' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(samples.releaseSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          recordId: 's-1',
          expectedMetadataVersion: 7,
        }),
      ),
    )
    expect(sonner.toast).toHaveBeenCalledWith('Sample released')
  })

  it('hides the release action from a role without the capability', async () => {
    routeContext.value = { workspace: { role: 'viewer' } }
    samples.fetchSample.mockResolvedValue(
      sample({ status: 'quarantined', quarantineReason: 'Awaiting QC' }),
    )
    renderRoute()

    await screen.findByText(/Awaiting QC/)
    expect(screen.queryByRole('button', { name: 'Release…' })).toBeNull()
  })

  it('records disposal for a past-hold sample and reports the RPC refusal', async () => {
    samples.fetchSample.mockResolvedValue(
      sample({
        status: 'hold_exceeded',
        createdAt: '2026-09-17T14:10:00.000Z',
        holdCondition: '2–8 °C',
        holdDurationDays: 7,
      }),
    )
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText(
      'Hold limit passed on 24 Sep 2026 (7 days at 2–8 °C).',
    )
    await user.click(screen.getByRole('button', { name: 'Record disposal' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'Hold limit passed')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(samples.disposeSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          recordId: 's-1',
          reason: 'Hold limit passed',
        }),
      ),
    )
    expect(sonner.toast).toHaveBeenCalledWith('Sample disposed')
  })

  it('surfaces a refused release as an error toast', async () => {
    samples.fetchSample.mockResolvedValue(
      sample({ status: 'quarantined', quarantineReason: 'Awaiting QC' }),
    )
    samples.releaseSample.mockRejectedValueOnce(
      new Error('release checks failed'),
    )
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText(/Awaiting QC/)
    await user.click(screen.getByRole('button', { name: 'Release…' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(sonner.toast.error).toHaveBeenCalledWith('release checks failed'),
    )
  })

  it('states the consumed date and actor from the event stream', async () => {
    samples.fetchSample.mockResolvedValue(
      sample({ status: 'consumed', quantity: 0 }),
    )
    samples.fetchSampleEvents.mockResolvedValue([consumeEvent()])
    renderRoute()

    await screen.findByText('Fully used on 11 Sep 2026 by Gareth P.')
    expect(screen.getByText(/AEX resin screen/)).toBeTruthy()
  })
})

describe('sample withdraw dialog', () => {
  it('shows the available amount and refuses an over-withdrawal inline', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('pAAV9-RC, lot P-117')
    await user.click(screen.getByRole('button', { name: 'Withdraw volume…' }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(/12.5 mg available/)).toBeTruthy()
    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '20',
    )
    expect(
      within(dialog).getByText('Only 12.5 mg left. Enter 12.5 or less.'),
    ).toBeTruthy()
    expect(
      within(dialog)
        .getByRole('button', { name: 'Withdraw' })
        .hasAttribute('disabled') ||
        within(dialog)
          .getByRole('button', { name: 'Withdraw' })
          .getAttribute('aria-disabled') === 'true',
    ).toBe(true)
    expect(samples.withdrawSample).not.toHaveBeenCalled()
  })

  it('withdraws through api.withdraw_sample with the purpose and container', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('pAAV9-RC, lot P-117')
    await user.click(screen.getByRole('button', { name: 'Withdraw volume…' }))
    const dialog = await screen.findByRole('dialog')

    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '3',
    )
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Purpose/ }),
      'exp-1',
    )
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Into/ }),
      'new',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: /New container label/ }),
      'Aliquot A',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }))

    await waitFor(() =>
      expect(samples.withdrawSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          recordId: 's-1',
          quantity: 3,
          unit: 'mg',
          purposeExperimentId: 'exp-1',
          expectedMetadataVersion: 7,
          newContainer: { title: 'Aliquot A' },
        }),
      ),
    )
    expect(sonner.toast).toHaveBeenCalledWith('Volume withdrawn')
  })

  it('surfaces an over-withdrawal refused by the server as a clear error toast', async () => {
    samples.fetchSampleQuantityBalances.mockResolvedValue({
      sampleRecordId: 's-1',
      unit: 'mg',
      current: 12.5,
      used: 0,
      reserved: 10,
      free: 12.5,
    })
    samples.withdrawSample.mockRejectedValueOnce(
      new DataClientError(
        'SB006',
        'insufficient free quantity: available 2, reserved 10, withdrawing 5',
        400,
      ),
    )
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('pAAV9-RC, lot P-117')
    await user.click(screen.getByRole('button', { name: 'Withdraw volume…' }))
    const dialog = await screen.findByRole('dialog')

    await user.type(
      within(dialog).getByRole('textbox', { name: /Volume/ }),
      '5',
    )
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Purpose/ }),
      'exp-1',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }))

    await waitFor(() =>
      expect(sonner.toast.error).toHaveBeenCalledWith(
        'Only 2 mg available. Enter 2 or less.',
      ),
    )
  })
})
