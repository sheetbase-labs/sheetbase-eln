import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RepeatFields } from '#/components/recurring/repeat-fields'
import { ScanSampleActions } from '#/components/scan/scan-sample-actions'
import { EditBookingDialog } from '#/components/schedule/edit-booking-dialog'
import type { ScheduleBooking } from '#/components/schedule/schedule-data'
import { NO_REPEAT } from '#/lib/recurring'
import type { RepeatForm } from '#/lib/recurring'
import { sampleQueryKeys } from '#/lib/samples'
import type { SampleRecord } from '#/lib/samples'
import {
  screenQueryClient,
  screenRoutes,
  stubDataClient,
  withApiReads,
} from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Three small bench-side pieces that sit on other screens: the actions after
 * scanning a sample (`scan/scan-sample-actions`), changing a booking
 * (`schedule/edit-booking-dialog`) and the repeat fields a booking and an
 * experiment schedule share (`recurring/repeat-fields`).
 */
const SAMPLE_ID = '0198d970-e266-4000-8000-0000000005a1'

const meta = {
  title: 'Lab/Bench actions',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/scan', ['/readings/new']),
        path: '/scan',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function inside(queryClient: QueryClient, width = 420) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ width }} className="max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const seeded = (data: ReadSeed[]) => screenQueryClient({ data })

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: SAMPLE_ID,
    projectId: null,
    kind: 'sample',
    identifier: 'SMP-2231',
    title: 'Harvest lot HL-0934',
    status: 'available',
    tags: [],
    structureVersion: 1,
    metadataVersion: 3,
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
    sampleType: 'Harvest',
    quantity: 4600,
    quantityUnit: 'mL',
    storageLocation: 'Cold room 2 / Shelf B',
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

const scanned = (record: SampleRecord | null) =>
  seeded([{ key: sampleQueryKeys.detail(SAMPLE_ID), value: record }])

// --- After a scan -----------------------------------------------------------

export const ScanAvailable: Story = {
  render: () => (
    <ScanSampleActions
      sampleId={SAMPLE_ID}
      returnTo="/scan?code=SMP-2231"
      client={stubDataClient()}
    />
  ),
  decorators: [withApiReads('error'), inside(scanned(sample()))],
}

export const ScanQuarantined: Story = {
  render: () => (
    <ScanSampleActions
      sampleId={SAMPLE_ID}
      returnTo="/scan?code=SMP-2231"
      client={stubDataClient()}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      scanned(
        sample({
          status: 'quarantined',
          quarantineReason: 'Awaiting sterility result',
        }),
      ),
    ),
  ],
}

export const ScanConsumed: Story = {
  render: () => (
    <ScanSampleActions
      sampleId={SAMPLE_ID}
      returnTo="/scan?code=SMP-2231"
      client={stubDataClient()}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(scanned(sample({ status: 'consumed', quantity: 0 }))),
  ],
}

export const ScanNotFound: Story = {
  render: () => (
    <div>
      <ScanSampleActions
        sampleId={SAMPLE_ID}
        returnTo="/scan?code=SMP-2231"
        client={stubDataClient()}
      />
      <p className="m-0 text-label text-fg-muted">
        The sample could not be read, so the actions render nothing.
      </p>
    </div>
  ),
  decorators: [withApiReads('error'), inside(scanned(null))],
}

// --- Edit a booking ---------------------------------------------------------

const booking: ScheduleBooking = {
  id: 'bk-1',
  resourceId: 'ins-1',
  title: 'EXP-0117 — Ambr run',
  date: '2026-11-10',
  start: '09:00',
  end: '11:30',
  timezone: 'Europe/London',
  createdByUserId: 'u-1',
  notes: 'Bring the calibration vials.',
  metadataVersion: 2,
  experiment: {
    id: 'e-1',
    identifier: 'EXP-0117',
    title: 'Harvest clarification',
  },
}

export const EditBooking: Story = {
  render: () => (
    <EditBookingDialog
      booking={booking}
      sampleOptions={[
        { id: 's-1', identifier: 'SMP-2231', title: 'Harvest lot HL-0934' },
        { id: 's-2', identifier: 'SMP-2232', title: 'Harvest lot HL-0935' },
      ]}
      currentSampleIds={['s-1']}
      client={stubDataClient()}
      onSaved={() => {}}
      onClose={() => {}}
    />
  ),
  decorators: [inside(seeded([]))],
}

export const EditBookingNoSamples: Story = {
  render: () => (
    <EditBookingDialog
      booking={{ ...booking, notes: null, experiment: undefined }}
      client={stubDataClient()}
      onSaved={() => {}}
      onClose={() => {}}
    />
  ),
  decorators: [inside(seeded([]))],
}

// --- Repeat fields ----------------------------------------------------------

function RepeatHarness({
  initial,
  allowNone = true,
}: {
  initial: RepeatForm
  allowNone?: boolean
}) {
  const [value, setValue] = useState(initial)

  return (
    <RepeatFields
      value={value}
      onChange={setValue}
      firstDay="2026-11-10"
      allowNone={allowNone}
    />
  )
}

export const RepeatNone: Story = {
  render: () => <RepeatHarness initial={NO_REPEAT} />,
  decorators: [inside(seeded([]), 360)],
}

export const RepeatWeekly: Story = {
  render: () => (
    <RepeatHarness
      initial={{
        ...NO_REPEAT,
        frequency: 'weekly',
        weekdays: [2, 4],
        endMode: 'count',
        count: 8,
      }}
    />
  ),
  decorators: [inside(seeded([]), 360)],
}

export const RepeatDailyUntilDate: Story = {
  render: () => (
    <RepeatHarness
      initial={{
        ...NO_REPEAT,
        frequency: 'daily',
        endMode: 'date',
        until: '2026-12-18',
      }}
      allowNone={false}
    />
  ),
  decorators: [inside(seeded([]), 360)],
}
