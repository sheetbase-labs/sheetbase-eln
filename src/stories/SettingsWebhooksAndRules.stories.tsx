import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { instrumentQueryKeys } from '#/components/instruments/instruments-data'
import { CreateWebhookDialog } from '#/components/settings/create-webhook-dialog'
import { ReleaseRulesPanel } from '#/components/settings/release-rules-panel'
import { SampleWorkflowsPanel } from '#/components/settings/sample-workflows-panel'
import { WebhookParserDialog } from '#/components/settings/webhook-parser-dialog'
import {
  IncomingWebhooks,
  OutgoingWebhooks,
} from '#/components/settings/webhook-sections'
import { releaseRuleKeys } from '#/lib/release-rules'
import { workflowKeys } from '#/lib/sample-workflows'
import type { WorkflowDraft, WorkflowSummary } from '#/lib/sample-workflows'
import { webhookAdminKeys, webhookRecipientKeys } from '#/lib/webhook-admin'
import type { WebhookSubscriptionWire } from '#/lib/webhook-admin'
import { holdRead, screenQueryClient, screenRoutes } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Webhooks, release checks and sample workflows in Settings
 * (`src/components/settings/`).
 *
 * Outgoing and incoming webhook lists, the two "add" dialogs, the release-rule
 * panel and the workflow panel. Reads are seeded by query key with
 * `staleTime: Infinity`; the dialogs that create something are shown at rest
 * and are never submitted, so no signing secret or key is ever minted.
 */
const meta = {
  title: 'Settings/Webhooks, release checks and workflows',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/settings/workspace/integrations', [
          '/settings/workspace/integrations/webhooks/$subscriptionId',
          '/pipelines/$pipelineId/triggers',
        ]),
        path: '/settings/workspace/integrations',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const WS = 'ws-1'

function provider(data: ReadSeed[], hold: ReadSeed['key'][] = []) {
  const client = screenQueryClient({ data })

  for (const key of hold) holdRead(client, key)

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <div className="flex min-h-[420px] w-[960px] max-w-full flex-col">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

function sub(
  overrides: Partial<WebhookSubscriptionWire> &
    Pick<WebhookSubscriptionWire, 'id'>,
): WebhookSubscriptionWire {
  return {
    key: 'aav9-process',
    url: 'https://hooks.example.com/aav9',
    channelType: 'webhook',
    recipientUserId: null,
    recipientName: null,
    description: '#aav9-process',
    eventTypes: ['pipeline.run.succeeded'],
    status: 'active',
    maxRetries: 5,
    failureThreshold: 10,
    consecutiveFailures: 0,
    rateLimitPerMinute: null,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  }
}

const health = (subscriptionId: string, over = {}) => ({
  subscriptionId,
  key: 'k',
  url: '',
  status: 'active',
  consecutiveFailures: 0,
  failureThreshold: 10,
  maxRetries: 5,
  rateLimitPerMinute: null,
  total24h: 4,
  delivered24h: 4,
  failed24h: 0,
  deadLetter24h: 0,
  retrying24h: 0,
  pending24h: 0,
  successRate24h: 1,
  lastDeliveredAt: '2026-10-14T08:00:00.000Z',
  oldestPendingAt: null,
  lastError: null,
  ...over,
})

const subscriptions = [
  sub({ id: 'w-1' }),
  sub({
    id: 'w-2',
    key: 'qc-email',
    channelType: 'email',
    url: '',
    description: null,
    recipientName: 'Priya Raman',
    eventTypes: [],
  }),
  sub({ id: 'w-3', key: 'lims', description: 'LIMS', status: 'disabled' }),
]

/** Where each outgoing webhook sends, and how its last delivery went. */
export const Outgoing: Story = {
  decorators: [
    provider([
      { key: webhookAdminKeys.subscriptions(WS), value: subscriptions },
      {
        key: webhookAdminKeys.health(WS),
        value: {
          data: [
            health('w-1'),
            health('w-2', { consecutiveFailures: 3, lastDeliveredAt: null }),
          ],
        },
      },
    ]),
  ],
  render: () => <OutgoingWebhooks workspaceId={WS} />,
}

export const OutgoingEmpty: Story = {
  decorators: [
    provider([
      { key: webhookAdminKeys.subscriptions(WS), value: [] },
      { key: webhookAdminKeys.health(WS), value: { data: [] } },
    ]),
  ],
  render: () => <OutgoingWebhooks workspaceId={WS} />,
}

export const Incoming: Story = {
  decorators: [
    provider([
      {
        key: ['admin-001', 'incoming-webhooks', WS],
        value: [
          {
            pipelineId: 'pl-1',
            displayId: 'PL-0004',
            name: 'Normalise plate reads',
            enabled: true,
            lastCallAt: '2026-10-14T07:00:00.000Z',
          },
          {
            pipelineId: 'pl-2',
            displayId: null,
            name: 'Stability roll-up',
            enabled: false,
            lastCallAt: null,
          },
        ],
      },
    ]),
  ],
  render: () => <IncomingWebhooks workspaceId={WS} />,
}

export const AddOutgoingWebhook: Story = {
  decorators: [
    provider([
      {
        key: webhookRecipientKeys.list(WS),
        value: [
          {
            userId: 'u-1',
            name: 'Priya Raman',
            email: 'priya@aavlabs.example',
          },
        ],
      },
    ]),
  ],
  render: () => <CreateWebhookDialog workspaceId={WS} onClose={() => {}} />,
}

function parserDialogProvider() {
  const client = screenQueryClient({ data: [] })
  client.setQueryData(instrumentQueryKeys.list, [], {
    updatedAt: Date.now() + 60 * 60 * 1000,
  })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

export const AddWebhookParser: Story = {
  decorators: [parserDialogProvider()],
  render: () => <WebhookParserDialog workspaceId={WS} onClose={() => {}} />,
}

const ruleSets = [
  {
    sampleType: '__all__',
    rules: [{ kind: 'no_result', result: 'fail' }],
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    sampleType: 'Lysate',
    rules: [
      { kind: 'min_measurements', count: 3 },
      { kind: 'measurement_range', measurement: 'od600', min: 0.1, max: 2 },
    ],
    updatedAt: '2026-09-10T09:00:00.000Z',
  },
]

/** Release checks per sample type, with one type's checks beside the list. */
export const ReleaseRules: Story = {
  decorators: [
    provider([
      { key: releaseRuleKeys.all(WS), value: ruleSets },
      { key: ['release-rules', 'sample-types'], value: ['Lysate', 'Plasmid'] },
    ]),
  ],
  render: () => <ReleaseRulesPanel workspaceId={WS} canManage />,
}

export const ReleaseRulesViewOnly: Story = {
  decorators: [
    provider([
      { key: releaseRuleKeys.all(WS), value: ruleSets },
      { key: ['release-rules', 'sample-types'], value: [] },
    ]),
  ],
  render: () => <ReleaseRulesPanel workspaceId={WS} canManage={false} />,
}

export const ReleaseRulesLoading: Story = {
  decorators: [provider([], [releaseRuleKeys.all(WS)])],
  render: () => <ReleaseRulesPanel workspaceId={WS} canManage />,
}

const summaries: WorkflowSummary[] = [
  {
    id: 'wf-1',
    name: 'Lysate intake',
    description: 'From receipt to storage.',
    sampleType: 'Lysate',
    autoEnrol: true,
    status: 'active',
    stageCount: 4,
    inProgress: 12,
  },
  {
    id: 'wf-2',
    name: 'Legacy plasmid check',
    description: null,
    sampleType: null,
    autoEnrol: false,
    status: 'archived',
    stageCount: 2,
    inProgress: 0,
  },
]

const draft: WorkflowDraft = {
  id: 'wf-1',
  name: 'Lysate intake',
  description: 'From receipt to storage.',
  sampleType: 'Lysate',
  autoEnrol: true,
  status: 'active',
  stages: [
    {
      key: 's1',
      id: 'st-1',
      name: 'Received',
      description: '',
      turnaroundDays: '1',
      final: false,
      requiredFields: [],
      actions: [{ kind: 'notify', to: 'steward', message: 'New lysate' }],
      next: ['s2'],
    },
    {
      key: 's2',
      id: 'st-2',
      name: 'Stored',
      description: '',
      turnaroundDays: '',
      final: true,
      requiredFields: ['location'],
      actions: [],
      next: [],
    },
  ],
}

const workflowSeeds: ReadSeed[] = [
  { key: workflowKeys.all(WS), value: summaries },
  {
    key: [...workflowKeys.all(WS), 'draft', 'wf-1'],
    value: draft,
  },
  { key: ['sample-types', WS], value: ['Lysate', 'Plasmid'] },
  {
    key: ['notebook-templates-for-workflows', WS],
    value: [{ id: 't-1', name: 'Expression run' }],
  },
]

export const SampleWorkflows: Story = {
  decorators: [provider(workflowSeeds)],
  render: () => (
    <SampleWorkflowsPanel
      workspaceId={WS}
      canManage
      editing={null}
      onEdit={() => {}}
    />
  ),
}

export const SampleWorkflowsViewOnly: Story = {
  decorators: [provider(workflowSeeds)],
  render: () => (
    <SampleWorkflowsPanel
      workspaceId={WS}
      canManage={false}
      editing={null}
      onEdit={() => {}}
    />
  ),
}

/** One workflow open: its steps, what each requires and does. */
export const SampleWorkflowEditor: Story = {
  decorators: [provider(workflowSeeds)],
  render: () => (
    <SampleWorkflowsPanel
      workspaceId={WS}
      canManage
      editing="wf-1"
      onEdit={() => {}}
    />
  ),
}

export const SampleWorkflowNew: Story = {
  decorators: [provider(workflowSeeds)],
  render: () => (
    <SampleWorkflowsPanel
      workspaceId={WS}
      canManage
      editing="new"
      onEdit={() => {}}
    />
  ),
}
