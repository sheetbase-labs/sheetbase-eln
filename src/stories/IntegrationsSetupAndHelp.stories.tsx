import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ShareWithClientDialog } from '#/components/client-sharing/share-with-client-dialog'
import { ContextHelp } from '#/components/help/context-help'
import { ConnectorConfigCard } from '#/components/integrations/config-card'
import { DatasetLandingLink } from '#/components/integrations/dataset-landing'
import { PickupCard } from '#/components/integrations/pickup-card'
import { LabSetupDialog } from '#/components/setup/lab-setup-dialog'
import { recordSharingKey } from '#/lib/client-sharing'
import type { ConnectorWire } from '#/lib/connectors/types'
import { screenQueryClient, screenRoutes } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Connector cards, client sharing, setup and page help
 * (`src/components/{integrations,client-sharing,setup,help}/`).
 *
 * Each reads at most a handful of things, so each story seeds them by query key
 * with `staleTime: Infinity`; none is saved, shared or finished, so nothing
 * reaches a database or the network.
 */
const meta = {
  title: 'Settings/Connectors, sharing and setup',
  parameters: {
    layout: 'centered',
    tanstack: {
      router: {
        route: screenRoutes('/settings/workspace/clients', [
          '/datasets/$datasetId',
          '/help',
          '/help/records',
        ]),
        path: '/settings/workspace/clients',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[760px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function provider(data: ReadSeed[]) {
  const client = screenQueryClient({ data })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

function connector(config: ConnectorWire['config']): ConnectorWire {
  return {
    id: 'c-1',
    workspace_id: 'ws-1',
    key: 'archive',
    name: 'Instrument archive',
    connector_type: 'storage',
    direction: 'inbound',
    status: 'active',
    parser_id: null,
    config,
    created_at: '2026-09-01T09:00:00.000Z',
    updated_at: '2026-09-01T09:00:00.000Z',
  }
}

/** An S3 source with its bucket set. */
export const SourceSettings: Story = {
  decorators: [provider([])],
  render: () => (
    <ConnectorConfigCard
      workspaceId="ws-1"
      adapter="s3"
      canManage
      connector={connector({
        adapter: 's3',
        bucket: 'aav-instrument-data',
        prefix: 'tb02/',
      })}
    />
  ),
}

/** A source with nothing set says what is missing. */
export const SourceSettingsMissing: Story = {
  decorators: [provider([])],
  render: () => (
    <ConnectorConfigCard
      workspaceId="ws-1"
      adapter="postgres"
      canManage={false}
      connector={connector({ adapter: 'postgres' })}
    />
  ),
}

const pickupSeeds: ReadSeed[] = [
  {
    key: ['ui-port', 'writable-projects', 'projects'],
    value: [
      {
        id: 'pr-1',
        title: 'AAV9 stability',
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
    value: [{ project_id: 'pr-1', can_edit: true }],
  },
  {
    key: ['connectors', 'pickup', 'schemas'],
    value: [
      {
        schemaDefinitionId: 'sd-1',
        schemaVersionId: 'sv-1',
        key: 'plate',
        name: 'Plate reader',
        description: null,
        version: 3,
      },
    ],
  },
  {
    key: ['connectors', 'pickup', 'datasets', 'sv-1'],
    value: [{ id: 'ds-1', name: 'Plate reads' }],
  },
  {
    key: ['connectors', 'pickup', 'instruments'],
    value: [{ id: 'inst-1', name: 'Plate reader PR-1' }],
  },
]

/** Where files from the watched-folder agent are kept and committed. */
export const FolderPickup: Story = {
  decorators: [provider(pickupSeeds)],
  render: () => (
    <PickupCard
      workspaceId="ws-1"
      canManage
      connector={connector({
        pickup: {
          projectId: 'pr-1',
          schemaVersionId: 'sv-1',
          datasetId: 'ds-1',
          autoDetect: true,
        },
      })}
    />
  ),
}

export const FolderPickupUnset: Story = {
  decorators: [provider(pickupSeeds)],
  render: () => (
    <PickupCard workspaceId="ws-1" canManage connector={connector({})} />
  ),
}

/** Where a connector's rows went: a link to the dataset's Imports tab. */
export const DatasetLanding: Story = {
  render: () => <DatasetLandingLink datasetId="ds-1" />,
}

const sharing = {
  recordStatus: 'approved',
  projectId: 'pr-1',
  clientId: 'cl-1',
  clientCode: 'ACME',
  clientName: 'Acme Bio',
  autoShare: false,
  sharedAt: null,
  sharedByName: null,
  canManage: true,
}

export const ShareWithClient: Story = {
  decorators: [provider([{ key: recordSharingKey('rec-1'), value: sharing }])],
  render: () => (
    <ShareWithClientDialog open onOpenChange={() => {}} recordId="rec-1" />
  ),
}

export const SharedWithClient: Story = {
  decorators: [
    provider([
      {
        key: recordSharingKey('rec-1'),
        value: {
          ...sharing,
          sharedAt: '2026-10-10T09:00:00.000Z',
          sharedByName: 'Priya Raman',
        },
      },
    ]),
  ],
  render: () => (
    <ShareWithClientDialog open onOpenChange={() => {}} recordId="rec-1" />
  ),
}

export const NotApprovedYet: Story = {
  decorators: [
    provider([
      {
        key: recordSharingKey('rec-1'),
        value: { ...sharing, recordStatus: 'in_review' },
      },
    ]),
  ],
  render: () => (
    <ShareWithClientDialog open onOpenChange={() => {}} recordId="rec-1" />
  ),
}

/** The first admin's one-click setup over Home. */
export const LabSetup: Story = {
  decorators: [provider([])],
  render: () => (
    <LabSetupDialog
      workspaceId="ws-1"
      workspaceName="AAV Labs"
      currentTimeZone="Europe/London"
      ownEmail="priya@aavlabs.example"
      onClose={() => {}}
    />
  ),
}

/** The help button for the page it sits on (here: Clients). */
export const PageHelp: Story = {
  render: () => <ContextHelp />,
}
