import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
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
  aliquotSample: vi.fn(),
  fetchSampleReleaseCheckStatus: vi.fn(),
  editSample: vi.fn(),
  receiveSample: vi.fn(),
  archiveSample: vi.fn(),
  restoreSample: vi.fn(),
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

vi.mock('#/lib/samples', async () => ({
  ...samples,
  releaseFailedChecks: (
    await vi.importActual<{ releaseFailedChecks: unknown }>('#/lib/samples')
  ).releaseFailedChecks,
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
  fetchSampleReleaseCheckStatus: samples.fetchSampleReleaseCheckStatus,
  sampleQueryKeys: {
    releaseChecks: (recordId: string) => [
      'reg-002',
      'samples',
      'release-checks',
      recordId,
    ],
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

vi.mock('#/lib/recents', () => ({ useRecentViewTracking: () => undefined }))

vi.mock('#/components/favourites/favourite-toggle', () => ({
  FavouriteToggle: () => null,
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
  samples.fetchSampleReleaseCheckStatus.mockResolvedValue({
    passed: false,
    ruleCount: 1,
    failedCount: 1,
    checks: [
      {
        key: 'purity',
        label: 'Purity result',
        kind: 'measurement_required',
        passed: false,
        detail: 'measurement Purity is missing or outside the required range',
      },
    ],
  })
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
    // The checks read the Measurements tab, so the banner goes there rather
    // than back to the page the user is already on.
    expect(
      screen
        .getByRole('button', { name: 'View release basis' })
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

  it('names the failed release checks in the dialog and links to measurements', async () => {
    samples.fetchSample.mockResolvedValue(
      sample({ status: 'quarantined', quarantineReason: 'Awaiting QC' }),
    )
    samples.releaseSample.mockRejectedValueOnce(
      new DataClientError(
        'SB093',
        'release checks failed: ["Purity above 95%", "Endotoxin below 5 EU/mL"]',
        400,
      ),
    )
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText(/Awaiting QC/)
    await user.click(screen.getByRole('button', { name: 'Release…' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('Purity above 95%')).toBeTruthy()
    expect(within(alert).getByText('Endotoxin below 5 EU/mL')).toBeTruthy()
    expect(
      within(alert)
        .getByRole('link', { name: 'Open measurements' })
        .getAttribute('href'),
    ).toBe('/samples/s-1/measurements')
    expect(sonner.toast.error).not.toHaveBeenCalled()
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

describe('sample aliquot and reading actions', () => {
  it('splits the sample into tubes through one call and lists them', async () => {
    samples.aliquotSample.mockResolvedValue({
      sample: sample({ quantity: 2.5 }),
      derivedSamples: [
        sample({ id: 't-1', identifier: 'SMP-9001', title: 'Tube 1' }),
        sample({ id: 't-2', identifier: 'SMP-9002', title: 'Tube 2' }),
      ],
    })
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('pAAV9-RC, lot P-117')
    await user.click(screen.getByRole('button', { name: 'Aliquot…' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByRole('textbox', { name: /Number of tubes/ }),
      '2',
    )
    await user.type(
      within(dialog).getByRole('textbox', { name: /Amount in each/ }),
      '5',
    )
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /For experiment/ }),
      'exp-1',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Make 2 tubes' }),
    )

    await waitFor(() =>
      expect(samples.aliquotSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          recordId: 's-1',
          count: 2,
          quantityEach: 5,
          purposeExperimentId: 'exp-1',
          expectedMetadataVersion: 7,
        }),
      ),
    )
    expect(
      await within(dialog).findByText('Made 2 tubes from SMP-2220'),
    ).toBeTruthy()
  })

  it('offers Record reading, which returns to this sample', async () => {
    renderRoute()
    await screen.findByText('pAAV9-RC, lot P-117')
    const link = screen.getByText('Record reading').closest('a')
    expect(link?.getAttribute('href')).toBe('/readings/new')
  })

  it('shows the live release checks on a quarantined sample, and not otherwise', async () => {
    samples.fetchSample.mockResolvedValue(
      sample({
        status: 'quarantined',
        quarantineReason: 'Awaiting purity',
        quarantinedAt: '2026-09-15T09:00:00.000Z',
      }),
    )
    const first = renderRoute()
    expect(await screen.findByText('Purity result')).toBeTruthy()
    expect(screen.getByText('0 of 1 checks pass')).toBeTruthy()
    first.unmount()

    samples.fetchSample.mockResolvedValue(sample())
    renderRoute()
    await screen.findByText('pAAV9-RC, lot P-117')
    expect(screen.queryByText('Purity result')).toBeNull()
    expect(samples.fetchSampleReleaseCheckStatus).toHaveBeenCalledTimes(1)
  })

  it('does not offer to aliquot a sample that cannot be withdrawn', async () => {
    samples.fetchSample.mockResolvedValue(sample({ status: 'quarantined' }))
    renderRoute()
    await screen.findByText('pAAV9-RC, lot P-117')
    expect(screen.queryByRole('button', { name: 'Aliquot…' })).toBeNull()
  })
})

describe('sample lineage export', () => {
  it('writes a CSV of the lineage it shows instead of promising a link', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:lineage')
    const revokeObjectURL = vi.fn()
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    samples.fetchSample.mockResolvedValue(sample({ status: 'disposed' }))
    samples.fetchSampleDerivedSamples.mockResolvedValue([
      {
        linkId: 'l-1',
        recordId: 's-2',
        parentRecordId: 's-1',
        identifier: 'SMP-2221',
        title: 'Aliquot A',
        status: 'available',
        relation: 'Derived by withdrawal',
        depth: 0,
      },
    ])
    try {
      renderRoute()
      const button = await screen.findByRole('button', {
        name: 'Export lineage',
      })
      vi.useFakeTimers()
      button.click()

      const blob = createObjectURL.mock.calls[0][0]
      expect(blob.type).toBe('text/csv')
      const csv = await blob.text()
      expect(csv).toContain('SMP-2221')
      expect(csv).toContain('Derived by withdrawal')
      // The blob URL is held open past the click so the browser can read it.
      expect(revokeObjectURL).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60_000)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:lineage')
      // Nothing was promised that does not exist.
      expect(sonner.toast).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })
})

describe('sample hold, edit, receive and archive controls', () => {
  it('extends a passed hold and keeps the allowed experiments', async () => {
    samples.fetchSample.mockResolvedValue(
      sample({
        status: 'hold_exceeded',
        holdDurationDays: 7,
        holdCondition: '2–8 °C',
        allowedUseExperimentIds: ['exp-1'],
      }),
    )
    samples.editSample.mockResolvedValue(sample())
    const user = userEvent.setup()
    renderRoute()

    await user.click(
      await screen.findByRole('button', { name: 'Extend hold…' }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Hold until/), {
      target: { value: '2026-12-01' },
    })
    await user.type(
      within(dialog).getByLabelText(/Reason for the change/),
      'Retested stable',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save hold' }))

    await waitFor(() =>
      expect(samples.editSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          recordId: 's-1',
          expectedMetadataVersion: 7,
          notes: 'Retested stable',
          properties: expect.objectContaining({
            holdUntil: '2026-12-01T00:00:00.000Z',
            holdDurationDays: 7,
            allowedUseExperimentIds: ['exp-1'],
          }),
        }),
      ),
    )
  })

  it('offers re-qualification for a past-hold sample to a releasing role', async () => {
    samples.fetchSample.mockResolvedValue(sample({ status: 'hold_exceeded' }))
    renderRoute()
    expect(
      await screen.findByRole('button', { name: 'Re-qualify…' }),
    ).toBeTruthy()
  })

  it('receives stock with the sample unit', async () => {
    samples.receiveSample.mockResolvedValue(sample())
    const user = userEvent.setup()
    renderRoute()

    await user.click(
      await screen.findByRole('button', { name: 'Receive stock…' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Quantity received/), '5')
    await user.click(within(dialog).getByRole('button', { name: 'Receive' }))

    await waitFor(() =>
      expect(samples.receiveSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ recordId: 's-1', quantity: 5, unit: 'mg' }),
      ),
    )
  })

  it('archives a sample, and an archived sample offers restore', async () => {
    samples.archiveSample.mockResolvedValue(sample())
    const user = userEvent.setup()
    renderRoute()

    await user.click(await screen.findByRole('button', { name: 'Archive…' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(samples.archiveSample).toHaveBeenCalled())

    cleanup()
    samples.fetchSample.mockResolvedValue(
      sample({ archivedAt: '2026-09-20T00:00:00.000Z' }),
    )
    samples.restoreSample.mockResolvedValue(sample())
    renderRoute()
    await user.click(
      await screen.findByRole('button', { name: 'Restore sample…' }),
    )
    const restoreDialog = await screen.findByRole('dialog')
    await user.click(
      within(restoreDialog).getByRole('button', { name: 'Confirm' }),
    )
    await waitFor(() =>
      expect(samples.restoreSample).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          recordId: 's-1',
          expectedMetadataVersion: 7,
        }),
      ),
    )
  })

  it('does not offer edit controls to a read-only role', async () => {
    routeContext.value = { workspace: { role: 'viewer' } }
    renderRoute()
    await screen.findByText('pAAV9-RC, lot P-117')
    expect(screen.queryByRole('button', { name: 'Edit hold…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Archive…' })).toBeNull()
  })
})
