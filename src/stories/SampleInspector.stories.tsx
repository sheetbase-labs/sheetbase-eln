import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import { SampleHoldMeter } from '#/components/v3/samples/sample-hold-meter'
import { SampleLabelCard } from '#/components/v3/samples/sample-label-card'
import { SampleRecentHistory } from '#/components/v3/samples/sample-recent-history'
import { SampleStateBanner } from '#/components/v3/samples/sample-state-banner'
import { UsageBalanceBar } from '#/components/v3/samples/sample-usage'
import type { SampleEvent, SampleRecord } from '#/lib/samples'

/**
 * The sample inspector's surfaces — the hold meter, the printed-label preview,
 * the lifecycle banner, the recent-history list and the usage bar
 * (`src/components/v3/samples/`). They are one file because they are one
 * screen: every one is rendered by SampleDetail / SampleLineage / SampleUsage,
 * and each reads only the sample it is given. The stories below show the real
 * states the data can be in, including the honest silences (no recorded hold,
 * no events, no banner) rather than the populated case alone.
 */
const SAMPLE_ID = '0198d970-e266-4000-8000-0000000005a1'
const NOW = new Date('2026-09-25T00:00:00.000Z')
const CREATED = '2026-09-20T00:00:00.000Z'

const meta = {
  title: 'Samples/Inspector surfaces',
  decorators: [
    (Story) => (
      <div className="w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

// --- Hold meter ------------------------------------------------------------

/** A live hold: the window runs from registration to the stored deadline. */
export const HoldMeter: Story = {
  render: () => (
    <SampleHoldMeter
      now={NOW}
      record={{
        createdAt: CREATED,
        properties: { holdCondition: '2–8 °C', holdUntil: '2026-10-04' },
      }}
    />
  ),
}

/** Past the deadline: the bar is full and takes the danger tone. */
export const HoldMeterExpired: Story = {
  render: () => (
    <SampleHoldMeter
      now={new Date('2026-10-10T00:00:00.000Z')}
      record={{
        createdAt: CREATED,
        properties: { holdCondition: '2–8 °C', holdUntil: '2026-10-04' },
      }}
    />
  ),
}

/** A sample with no hold or expiry recorded says so rather than inventing a window. */
export const HoldMeterNoWindow: Story = {
  render: () => <SampleHoldMeter now={NOW} record={{ createdAt: CREATED }} />,
}

// --- Label preview ---------------------------------------------------------

const labelRecord = {
  identifier: 'SMP-2231',
  title: 'Harvest lot HL-0934',
  sampleType: 'Cell harvest',
  barcode: 'SMP-LVV-0020',
  customFields: { batch: 'HL-0934' },
  createdAt: CREATED,
  properties: { holdCondition: '2–8 °C', holdUntil: '2026-10-04' },
}

/** The DEC-10 QR, the lot and the storage condition with its use-by. */
export const LabelCard: Story = {
  render: () => (
    <SampleLabelCard host="app.sheetbase.test" record={labelRecord} />
  ),
}

/** Without a host there is no honest payload, so the card says "No code". */
export const LabelCardNoCode: Story = {
  render: () => <SampleLabelCard host="" record={labelRecord} />,
}

/** Facts the sample does not carry are omitted, not filled with placeholders. */
export const LabelCardIdentifierOnly: Story = {
  render: () => (
    <SampleLabelCard
      host="app.sheetbase.test"
      record={{ identifier: 'SMP-2232', customFields: {} }}
    />
  ),
}

// --- Lifecycle banner ------------------------------------------------------

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: SAMPLE_ID,
    projectId: '0198d970-e266-4000-8000-000000000009',
    kind: 'sample',
    identifier: 'SMP-2220',
    title: 'pAAV9-RC, lot P-117',
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

function event(overrides: Partial<SampleEvent> = {}): SampleEvent {
  return {
    id: 'evt-1',
    recordId: SAMPLE_ID,
    operation: 'edit',
    quantityDelta: null,
    quantityBefore: null,
    quantityAfter: null,
    quantityUnit: null,
    fromLocation: null,
    toLocation: null,
    actorUserId: 'u-1',
    purposeRecordId: null,
    notes: null,
    createdAt: '2026-09-22T09:15:00.000Z',
    ...overrides,
  }
}

const consumeEvent = event({
  id: 'evt-consume',
  operation: 'consume',
  quantityDelta: -10350,
  quantityBefore: 14950,
  quantityAfter: 4600,
  quantityUnit: 'mL',
  actorUserId: 'u-gareth',
  notes: 'Final harvest draw',
  createdAt: '2026-09-23T09:15:00.000Z',
})

/** Quarantined with its real reason and the action the detail page offers. */
export const StateBannerQuarantined: Story = {
  render: () => (
    <SampleStateBanner
      sample={sample({
        status: 'quarantined',
        quarantineReason: 'Endotoxin pending',
        quarantinedAt: '2026-09-24T08:00:00.000Z',
      })}
      action={<Button size="sm">View release checks</Button>}
    />
  ),
}

/** Past its hold: the window and the allowed-use rule both come from stored data. */
export const StateBannerHoldExceeded: Story = {
  render: () => (
    <SampleStateBanner
      sample={sample({
        status: 'hold_exceeded',
        holdStartedAt: '2026-09-15T00:00:00.000Z',
        holdDurationDays: 7,
        holdCondition: '2–8 °C',
        allowedUseExperimentIds: ['exp-1'],
      })}
    />
  ),
}

export const StateBannerExpired: Story = {
  render: () => (
    <SampleStateBanner
      sample={sample({
        status: 'expired',
        properties: { expiryDate: '2026-09-24' },
      })}
    />
  ),
}

/** Fully used: the date, actor and note are read from the consume event. */
export const StateBannerConsumed: Story = {
  render: () => (
    <SampleStateBanner
      sample={sample({ status: 'consumed' })}
      events={[consumeEvent]}
      userName={(userId) => (userId === 'u-gareth' ? 'Gareth P.' : null)}
    />
  ),
}

export const StateBannerDisposed: Story = {
  render: () => (
    <SampleStateBanner
      sample={sample({
        status: 'disposed',
        disposalReason: 'Expired stock removed from the cold room',
        disposedAt: '2026-09-26T10:00:00.000Z',
      })}
    />
  ),
}

/** The normal lifecycle state is the silent one: the banner renders nothing. */
export const StateBannerNormal: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <SampleStateBanner sample={sample()} />
      <p className="m-0 text-caption text-fg-muted">
        No banner is rendered: an available sample has no lifecycle state to
        report.
      </p>
    </div>
  ),
}

// --- Recent history --------------------------------------------------------

const historyEvents: SampleEvent[] = [
  event({
    id: 'evt-print',
    operation: 'print',
    actorUserId: 'u-ada',
    createdAt: '2026-09-21T08:00:00.000Z',
  }),
  event({
    id: 'evt-transfer',
    operation: 'transfer',
    fromLocation: 'F-1 shelf 2',
    toLocation: 'F-2 box 14 A1',
    actorUserId: 'u-ada',
    createdAt: '2026-09-22T14:05:00.000Z',
  }),
  consumeEvent,
]

function actorLabel(entry: SampleEvent): string | null {
  if (entry.actorUserId === 'u-gareth') return 'Gareth P.'
  if (entry.actorUserId === 'u-ada') return 'Ada S.'
  return null
}

/** The three most recent events, reduced to the design's day · actor · action line. */
export const RecentHistory: Story = {
  render: () => (
    <SampleRecentHistory events={historyEvents} actorLabel={actorLabel} />
  ),
}

/** Only the newest three: the inspector is a summary, not the History tab. */
export const RecentHistoryLimited: Story = {
  render: () => (
    <SampleRecentHistory
      events={historyEvents}
      actorLabel={actorLabel}
      limit={2}
    />
  ),
}

/** An honest empty list, not an empty container. */
export const RecentHistoryEmpty: Story = {
  render: () => <SampleRecentHistory events={[]} actorLabel={actorLabel} />,
}

/** An event whose actor cannot be resolved still states what happened. */
export const RecentHistoryUnknownActor: Story = {
  render: () => (
    <SampleRecentHistory events={[consumeEvent]} actorLabel={() => null} />
  ),
}

// --- Usage -----------------------------------------------------------------

const balances = {
  sampleRecordId: SAMPLE_ID,
  unit: 'mL',
  current: 4600,
  used: 10400,
  reserved: 3000,
  free: 1600,
}

/** Used + reserved + free fill the registered volume exactly. */
export const Usage: Story = {
  render: () => <UsageBalanceBar balances={balances} />,
}

/** A sample with no balance row yet: the bar is honestly empty. */
export const UsageNoBalance: Story = {
  render: () => <UsageBalanceBar balances={null} />,
}
