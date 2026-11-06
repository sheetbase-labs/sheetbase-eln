import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  AgentDownload,
  AgentStatusLabel,
  AgentStatusLine,
} from '#/components/instruments/agent-download'
import { IntakeDeliveryNotice } from '#/components/instruments/intake-delivery-notice'
import { IntakeSetupDialog } from '#/components/instruments/intake-setup-dialog'
import { instrumentQueryKeys } from '#/components/instruments/instruments-data'
import type {
  InstrumentRow,
  ServiceLogRow,
} from '#/components/instruments/instruments-data'
import { liveFeedQueryKeys } from '#/components/instruments/live-feeds-data'
import type {
  FeedRow,
  SeriesPoint,
} from '#/components/instruments/live-feeds-data'
import {
  LiveReadingsSection,
  LiveSetupDialog,
} from '#/components/instruments/live-readings'
import {
  BackInServiceDialog,
  MarkOutOfServiceDialog,
  OutOfServiceNotice,
  ServiceLogSection,
} from '#/components/instruments/out-of-service'
import { ParserFollowUpNotice } from '#/components/instruments/parser-follow-up'
import { RequestQualificationButton } from '#/components/instruments/request-qualification-button'
import { Button } from '#/components/ui/button'
import { agentQueryKeys } from '#/lib/connectors/agent-client'
import { parserSettingsQueryKeys } from '#/lib/parser-settings'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * The instrument page's parts (`src/components/instruments/`): the notices
 * for an instrument that is not delivering data, the data-intake setup and the
 * folder agent, the live readings chart, and taking an instrument out of
 * service. They are one file because they are all pieces of one page; each
 * story shows the state that changes what the piece says.
 */
const INSTRUMENT_ID = '0198d970-e266-4000-8000-000000000a01'
const CONNECTOR_ID = '0198d970-e266-4000-8000-000000000c01'

const meta = {
  title: 'Instruments/Page parts',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/instruments/$instrumentId', [
          '/import',
          '/settings/lab/instruments',
        ]),
        path: '/instruments/$instrumentId',
        params: { instrumentId: INSTRUMENT_ID },
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function inside(queryClient: QueryClient, width = 640) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ width }} className="max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const empty = () => screenQueryClient()
const seeded = (data: ReadSeed[]) => screenQueryClient({ data })

const instrument: InstrumentRow = {
  id: INSTRUMENT_ID,
  displayId: 'INS-0007',
  name: 'Ambr 250 bioreactor',
  instrumentType: 'Bioreactor',
  model: 'Ambr 250 HT',
  serialNumber: 'A250-2291',
  vendor: 'Sartorius',
  location: 'Lab 2, bench 4',
  ownerId: null,
  retiredAt: null,
  outOfServiceAt: null,
  intakeMethod: 'filedrop',
  position: 1,
  updatedAt: '2026-11-01T09:00:00Z',
}
const down: InstrumentRow = {
  ...instrument,
  outOfServiceAt: '2026-11-02T08:00:00Z',
  outOfServiceReason: 'Pump 3 is not holding pressure',
  expectedBackOn: '2026-11-09',
  outOfServiceBy: 'u-1',
}
const names = { userLabel: () => 'Ada Okafor' }

// --- Delivery and parser notices -------------------------------------------

export const DeliveryFailed: Story = {
  render: () => (
    <IntakeDeliveryNotice
      instrumentId={INSTRUMENT_ID}
      instrumentName="Ambr 250 bioreactor"
      problem="failed"
      canImport
    />
  ),
  decorators: [inside(empty())],
}

export const DeliveryStaleWithSetUp: Story = {
  render: () => (
    <IntakeDeliveryNotice
      instrumentId={INSTRUMENT_ID}
      instrumentName="Ambr 250 bioreactor"
      problem="stale"
      canImport
      onSetUp={() => {}}
    />
  ),
  decorators: [inside(empty())],
}

export const DeliveryWaitingNoAccess: Story = {
  render: () => (
    <IntakeDeliveryNotice
      instrumentId={INSTRUMENT_ID}
      instrumentName="Ambr 250 bioreactor"
      problem="waiting"
      canImport={false}
    />
  ),
  decorators: [inside(empty())],
}

export const ParserMissing: Story = {
  render: () => (
    <ParserFollowUpNotice
      instrumentName="Ambr 250 bioreactor"
      followUp={{ kind: 'missing', search: { instrumentId: INSTRUMENT_ID } }}
      canEdit
    />
  ),
  decorators: [inside(empty())],
}

export const ParserDraft: Story = {
  render: () => (
    <ParserFollowUpNotice
      instrumentName="Ambr 250 bioreactor"
      followUp={{
        kind: 'draft',
        search: { instrumentId: INSTRUMENT_ID, versionId: 'pv-1' },
      }}
      canEdit
    />
  ),
  decorators: [inside(empty())],
}

export const ParserDraftNoEditRights: Story = {
  render: () => (
    <ParserFollowUpNotice
      instrumentName="Ambr 250 bioreactor"
      followUp={{ kind: 'draft', search: { instrumentId: INSTRUMENT_ID } }}
      canEdit={false}
    />
  ),
  decorators: [inside(empty())],
}

// --- Qualification request --------------------------------------------------

export const QualificationRequest: Story = {
  render: () => (
    <RequestQualificationButton
      instrumentId={INSTRUMENT_ID}
      instrumentName="Ambr 250 bioreactor"
    />
  ),
  decorators: [inside(empty(), 240)],
}

export const QualificationRequested: Story = {
  render: () => (
    <RequestQualificationButton
      instrumentId={INSTRUMENT_ID}
      instrumentName="Ambr 250 bioreactor"
      alreadyRequested
    />
  ),
  decorators: [inside(empty(), 240)],
}

// --- Folder agent -----------------------------------------------------------

const agentStatus = (status: object | null): ReadSeed[] =>
  status ? [{ key: agentQueryKeys.status(CONNECTOR_ID), value: status }] : []

const agentLine = (status: object | null) => (
  <div className="flex items-center gap-2">
    <AgentStatusLabel />
    <AgentStatusLine
      connectorId={CONNECTOR_ID}
      fetchStatus={() => new Promise(() => {})}
    />
    {status ? null : <span className="sr-only">no status yet</span>}
  </div>
)

export const AgentRunning: Story = {
  render: () => agentLine({}),
  decorators: [
    inside(
      seeded(
        agentStatus({
          downloaded: true,
          running: true,
          lastSeenAt: new Date(Date.now() - 40_000).toISOString(),
        }),
      ),
      360,
    ),
  ],
}

export const AgentQuiet: Story = {
  render: () => agentLine({}),
  decorators: [
    inside(
      seeded(
        agentStatus({
          downloaded: true,
          running: false,
          lastSeenAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        }),
      ),
      360,
    ),
  ],
}

export const AgentNotDownloaded: Story = {
  render: () => agentLine({}),
  decorators: [
    inside(
      seeded(
        agentStatus({ downloaded: false, running: false, lastSeenAt: null }),
      ),
      360,
    ),
  ],
}

export const AgentDownloadForm: Story = {
  render: () => <AgentDownload connectorId={CONNECTOR_ID} canManage />,
  decorators: [inside(empty())],
}

export const AgentDownloadFailed: Story = {
  render: () => (
    <AgentDownload
      connectorId={CONNECTOR_ID}
      canManage
      download={() =>
        Promise.reject(new Error('The package could not be built.'))
      }
    />
  ),
  decorators: [inside(empty())],
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('button')?.click()
  },
}

export const AgentDownloadNoAccess: Story = {
  render: () => <AgentDownload connectorId={CONNECTOR_ID} canManage={false} />,
  decorators: [inside(empty())],
}

// --- Intake setup -----------------------------------------------------------

const projectReads: ReadSeed[] = [
  {
    key: ['ui-port', 'writable-projects', 'projects'],
    value: [
      {
        id: 'p-1',
        title: 'Process Development',
        archived_at: null,
        status: 'active',
        display_id: 'PRJ-0001',
        stage: null,
        modality: null,
      },
    ],
  },
  {
    key: ['ui-port', 'writable-projects', 'access'],
    value: [{ project_id: 'p-1', can_edit: true, can_manage: true }],
  },
  { key: ['instrument-intake', 'schemas'], value: [] },
]

const parserReads: ReadSeed[] = [
  {
    key: parserSettingsQueryKeys.list('ws-1'),
    value: [
      {
        id: 'parser-1',
        key: 'ambr',
        name: 'Ambr run export',
        format: 'csv',
        instrument_id: INSTRUMENT_ID,
        instruments: { id: INSTRUMENT_ID, name: 'Ambr 250 bioreactor' },
        parser_versions: [
          {
            id: 'pv-1',
            version: 1,
            status: 'approved',
            signature: null,
            mapping: {},
            test_result: null,
            validated_at: '2026-10-20T09:00:00Z',
            approved_at: '2026-10-21T09:00:00Z',
            approved_by_user_id: null,
          },
        ],
      },
    ],
  },
]

const setupInstrument = {
  id: INSTRUMENT_ID,
  name: 'Ambr 250 bioreactor',
  displayId: 'INS-0007',
}

export const IntakeSetupFormat: Story = {
  render: () => (
    <IntakeSetupDialog
      workspaceId="ws-1"
      instrument={setupInstrument}
      intakeMethod="manual"
      connector={null}
      canManage
      onClose={() => {}}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(seeded([...projectReads, ...parserReads])),
  ],
}

export const IntakeSetupParsersFailed: Story = {
  render: () => (
    <IntakeSetupDialog
      workspaceId="ws-1"
      instrument={setupInstrument}
      intakeMethod="manual"
      connector={null}
      canManage
      onClose={() => {}}
    />
  ),
  decorators: [withApiReads('error'), inside(seeded(projectReads))],
}

export const IntakeSetupAgentStep: Story = {
  render: () => (
    <IntakeSetupDialog
      workspaceId="ws-1"
      instrument={setupInstrument}
      intakeMethod="filedrop"
      connector={{
        id: CONNECTOR_ID,
        workspace_id: 'ws-1',
        key: 'ambr_intake',
        name: 'Ambr 250 bioreactor intake',
        connector_type: 'instrument',
        direction: 'inbound',
        status: 'active',
        parser_id: null,
        config: { pickup: { instrumentId: INSTRUMENT_ID } },
        created_at: '2026-10-20T09:00:00Z',
        updated_at: '2026-10-20T09:00:00Z',
      }}
      canManage
      initialStep={3}
      onClose={() => {}}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(seeded([...projectReads, ...parserReads])),
  ],
}

// --- Live readings ----------------------------------------------------------

const feedAt = (seconds: number) =>
  new Date(Date.now() - seconds * 1000).toISOString()

const feeds: FeedRow[] = [
  {
    id: 'feed-1',
    ownerId: INSTRUMENT_ID,
    instrumentId: INSTRUMENT_ID,
    storageUnitId: null,
    storageRoomId: null,
    outOfRangeSince: null,
    name: 'Temperature',
    unit: '°C',
    lowLimit: 35,
    highLimit: 38,
    limitState: 'ok',
    lastValue: 36.8,
    lastAt: feedAt(5),
    readingCount: 5120,
  },
  {
    id: 'feed-2',
    ownerId: INSTRUMENT_ID,
    instrumentId: INSTRUMENT_ID,
    storageUnitId: null,
    storageRoomId: null,
    outOfRangeSince: null,
    name: 'Dissolved oxygen',
    unit: '%',
    lowLimit: 30,
    highLimit: null,
    limitState: 'low',
    lastValue: 24.5,
    lastAt: feedAt(8),
    readingCount: 5090,
  },
]

function seriesFor(feedId: string, base: number): ReadSeed {
  const until = Date.now()
  const since = until - 60 * 60_000
  const points: SeriesPoint[] = Array.from({ length: 60 }, (_, i) => {
    const avg = base + Math.sin(i / 6) * 0.8
    return {
      at: since + i * 60_000,
      min: avg - 0.3,
      avg,
      max: avg + 0.3,
      readings: 12,
    }
  })
  return {
    key: liveFeedQueryKeys.series(feedId, '1h'),
    value: { since, until, points },
  }
}

export const LiveReadingsWithFeeds: Story = {
  render: () => (
    <LiveReadingsSection instrument={instrument} canSetUp canSetLimits />
  ),
  decorators: [
    // The page polls every few seconds; a poll that never answers leaves the
    // seeded readings on screen.
    withApiReads('pending'),
    inside(
      seeded([
        { key: liveFeedQueryKeys.feeds(INSTRUMENT_ID), value: feeds },
        seriesFor('feed-1', 36.8),
        seriesFor('feed-2', 26),
        {
          key: agentQueryKeys.liveStatus(INSTRUMENT_ID),
          value: {
            downloaded: true,
            running: true,
            lastSeenAt: feedAt(20),
          },
        },
      ]),
      880,
    ),
  ],
}

export const LiveReadingsNoFeeds: Story = {
  render: () => (
    <LiveReadingsSection instrument={instrument} canSetUp canSetLimits />
  ),
  decorators: [
    withApiReads('pending'),
    inside(
      seeded([{ key: liveFeedQueryKeys.feeds(INSTRUMENT_ID), value: [] }]),
      880,
    ),
  ],
}

export const LiveReadingsNoAccess: Story = {
  render: () => (
    <LiveReadingsSection
      instrument={instrument}
      canSetUp={false}
      canSetLimits={false}
    />
  ),
  decorators: [
    withApiReads('pending'),
    inside(
      seeded([{ key: liveFeedQueryKeys.feeds(INSTRUMENT_ID), value: [] }]),
      880,
    ),
  ],
}

export const LiveSetup: Story = {
  render: () => (
    <LiveSetupDialog instrument={instrument} open onOpenChange={() => {}} />
  ),
  decorators: [
    withApiReads('pending'),
    inside(
      seeded([
        {
          key: agentQueryKeys.liveStatus(INSTRUMENT_ID),
          value: { downloaded: false, running: false, lastSeenAt: null },
        },
      ]),
    ),
  ],
}

// --- Out of service ---------------------------------------------------------

const serviceLog: ServiceLogRow[] = [
  {
    id: 'sl-1',
    instrumentId: INSTRUMENT_ID,
    kind: 'repair',
    visitedOn: '2026-09-14',
    summary: 'Replaced pump 2 tubing',
    details: null,
    performedBy: 'Sartorius field engineer',
    loggedBy: 'u-1',
    createdAt: '2026-09-14T12:00:00Z',
  },
  {
    id: 'sl-2',
    instrumentId: INSTRUMENT_ID,
    kind: 'service',
    visitedOn: '2026-06-02',
    summary: 'Annual preventive service',
    details: 'All probes recalibrated.',
    performedBy: null,
    loggedBy: 'u-1',
    createdAt: '2026-06-02T12:00:00Z',
  },
]

export const OutOfServiceStrip: Story = {
  render: () => (
    <OutOfServiceNotice
      instrument={down}
      names={names}
      action={<Button size="sm">Back in service</Button>}
    />
  ),
  decorators: [inside(empty())],
}

export const MarkOutOfService: Story = {
  render: () => (
    <MarkOutOfServiceDialog
      instrument={instrument}
      open
      onOpenChange={() => {}}
    />
  ),
  decorators: [inside(empty())],
}

export const BackInService: Story = {
  render: () => (
    <BackInServiceDialog instrument={down} open onOpenChange={() => {}} />
  ),
  decorators: [inside(empty())],
}

export const ServiceLogWithVisits: Story = {
  render: () => (
    <ServiceLogSection instrument={instrument} canLog names={names} />
  ),
  decorators: [
    inside(
      seeded([
        {
          key: instrumentQueryKeys.serviceLog(INSTRUMENT_ID),
          value: serviceLog,
        },
      ]),
      760,
    ),
  ],
}

export const ServiceLogEmpty: Story = {
  render: () => (
    <ServiceLogSection instrument={instrument} canLog={false} names={names} />
  ),
  decorators: [
    inside(
      seeded([
        { key: instrumentQueryKeys.serviceLog(INSTRUMENT_ID), value: [] },
      ]),
      760,
    ),
  ],
}
