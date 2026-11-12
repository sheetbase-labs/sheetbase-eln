import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PublishDialog } from '#/components/plugins/publish-dialog'
import { PluginChannels } from '#/components/settings/plugin-channels'
import { PluginConnectionsDialog } from '#/components/settings/plugin-connections-dialog'
import { channelsQueryKey } from '#/lib/extensions/outgoing-client'
import type {
  ChannelWire,
  ConnectionWire,
} from '#/lib/extensions/outgoing-client'
import { withApiReads } from './screen-stories'

/**
 * The places a plugin sends data out: a connection an administrator sets up,
 * a notification channel a person turns on, a dataset sent to another system,
 * and the plugin operations. None of them presses a button that sends.
 */
const connections: ConnectionWire[] = [
  {
    extensionId: 'e1',
    extensionKey: 'outbound-tools',
    extensionName: 'Outbound tools',
    point: 'publishers',
    itemId: 'send-to-lims',
    title: 'Lab information system',
    hosts: ['lims.example.org'],
    off: false,
    settings: [
      {
        name: 'token',
        label: 'API token',
        secret: true,
        required: true,
        isSet: false,
        value: null,
      },
    ],
  },
  {
    extensionId: 'e1',
    extensionKey: 'outbound-tools',
    extensionName: 'Outbound tools',
    point: 'notification-channels',
    itemId: 'slack',
    title: 'Slack',
    hosts: ['slack.com'],
    off: false,
    settings: [
      {
        name: 'bot_token',
        label: 'Slack bot token',
        secret: true,
        required: true,
        isSet: true,
        value: null,
      },
    ],
  },
]

const channels: ChannelWire[] = [
  {
    extensionKey: 'outbound-tools',
    extensionName: 'Outbound tools',
    channelId: 'slack',
    title: 'Slack',
    description: 'Sends your notifications as a Slack direct message.',
    destinationLabel: 'Slack member ID',
    destinationHint: 'U01ABCDEF',
    ready: true,
    mine: {
      destination: 'U01ABCDEF',
      scope: 'phone',
      lastSentAt: null,
      lastError: null,
    },
  },
]

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

const meta = {
  title: 'Plugins/Sending data out',
  decorators: [
    withApiReads('error'),
    (Story) => (
      <QueryClientProvider client={client()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const ConnectionsDialog: Story = {
  render: () => (
    <PluginConnectionsDialog
      name="Outbound tools"
      connections={connections}
      onClose={() => {}}
    />
  ),
}

export const NotificationChannel: Story = {
  decorators: [
    (Story) => {
      const seeded = client()
      seeded.setQueryData(channelsQueryKey, channels)

      return (
        <QueryClientProvider client={seeded}>
          <Story />
        </QueryClientProvider>
      )
    },
  ],
  render: () => <PluginChannels />,
}

export const SendDataset: Story = {
  render: () => (
    <PublishDialog
      datasetName="Plate reader run 7"
      datasetId="d1"
      onClose={() => {}}
      publisher={{
        extensionId: 'e1',
        extensionKey: 'outbound-tools',
        extensionName: 'Outbound tools',
        manifestId: 'acme.outbound-tools',
        manifestVersion: '1.0.0',
        point: 'publishers',
        id: 'send-to-lims',
        name: 'plugin.outbound-tools.send-to-lims',
        declaration: {
          id: 'send-to-lims',
          title: 'Lab information system',
          description: 'Sends the rows of a dataset as a new batch of results.',
          hosts: ['lims.example.org'],
          settings: [],
          parameters: [
            {
              name: 'project',
              type: 'text',
              required: true,
              label: 'LIMS project code',
            },
          ],
          runner: { kind: 'python', entry: 'outbound:plan_lims' },
          parse: { kind: 'python', entry: 'outbound:read_lims' },
        },
      }}
    />
  ),
}
