import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ScheduleDialog } from '#/components/pipelines/schedule-dialog'
import { ScheduleHistoryDialog } from '#/components/pipelines/schedule-history'
import {
  ElnActions,
  RunKeeps,
  RunNotifications,
  WebhookCard,
} from '#/components/pipelines/triggers-outputs'
import type {
  PipelineRunWire,
  PipelineScheduleActivityWire,
  PipelineScheduleWire,
} from '#/lib/pipelines/types'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Pipeline triggers and outputs (`src/components/pipelines/`).
 *
 * The add/edit trigger dialog and one trigger's history, plus the cards that
 * say how a version starts and what it does when it ends: the incoming webhook,
 * what a run keeps, the ELN actions it takes and who hears about it. Reads are
 * seeded by query key; the webhook card's endpoint is a `fetch`, so its state
 * is seeded too and no story turns it on or off.
 */
const meta = {
  title: 'Pipelines/Triggers and outputs',
  parameters: {
    layout: 'centered',
    tanstack: {
      router: {
        route: screenRoutes('/pipelines/$pipelineId/triggers', [
          '/pipelines/$pipelineId/steps',
          '/pipelines/runs/$runId',
        ]),
        path: '/pipelines/$pipelineId/triggers',
        params: { pipelineId: 'pl-1' },
      },
    },
  },
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

const schedule: PipelineScheduleWire = {
  id: 'sch-1',
  workspace_id: 'ws-1',
  definition_id: 'pl-1',
  kind: 'daily',
  spec: {
    dailyAt: '06:30',
    timeZone: 'Europe/London',
    inputs: {},
    parameters: {},
  },
  enabled: true,
  last_run_at: '2026-10-14T05:30:00.000Z',
  next_run_at: '2026-10-15T05:30:00.000Z',
  last_evaluated_at: '2026-10-14T05:30:00.000Z',
  last_evaluated_sequence: null,
  input_watermarks: { readings: 'dv-1' },
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  created_by_user_id: 'u-1',
}

function runRow(n: number, status: PipelineRunWire['status']): PipelineRunWire {
  return {
    id: `run-${n}`,
    workspace_id: 'ws-1',
    definition_version_id: 'ver-1',
    trigger_kind: 'scheduled',
    status,
    attempt: 1,
    retry_of_run_id: null,
    trigger_occurrence_id: null,
    schedule_id: 'sch-1',
    input_digest: null,
    parameters: {},
    input_versions: {},
    result: {},
    error_code: null,
    error_message: null,
    started_at: `2026-10-1${n}T05:30:00.000Z`,
    finished_at: `2026-10-1${n}T05:31:00.000Z`,
    actor_user_id: null,
    actor_credential_id: null,
    created_at: `2026-10-1${n}T05:30:00.000Z`,
  }
}

const activity: PipelineScheduleActivityWire[] = [
  {
    id: 'a-1',
    schedule_id: 'sch-1',
    definition_id: 'def-1',
    source: 'schedule',
    label: null,
    run_id: null,
    kind: 'skipped_unchanged',
    occurrence_id: null,
    message: 'No new dataset version since the last run.',
    detail: { count: 3 },
    occurred_at: '2026-10-13T05:30:00.000Z',
  },
  {
    id: 'a-2',
    schedule_id: 'sch-1',
    definition_id: 'def-1',
    source: 'schedule',
    label: null,
    run_id: null,
    kind: 'start_failed',
    occurrence_id: null,
    message: 'The run could not start.',
    detail: {},
    occurred_at: '2026-10-12T05:30:00.000Z',
  },
]

const client = screenQueryClient({
  data: [
    {
      key: ['ui-port', 'pipelines', 'trigger-dataset-options'],
      value: [{ id: 'ds-1', label: 'DS-0012 · Plate reads' }],
    },
    {
      key: ['ui-port', 'pipelines', 'dataset-version-choices'],
      value: [],
    },
    {
      key: ['ui-port', 'pipelines', 'schedule-runs', 'sch-1'],
      value: [runRow(4, 'succeeded'), runRow(3, 'failed')],
    },
    {
      key: ['ui-port', 'pipelines', 'schedule-activity', 'sch-1'],
      value: activity,
    },
    {
      key: ['ui-port', 'pipelines', 'webhook-trigger', 'pl-on'],
      value: {
        enabled: true,
        url: 'https://eln.example.com/api/pipelines/webhook/pl-on',
      },
    },
    {
      key: ['ui-port', 'pipelines', 'webhook-trigger', 'pl-off'],
      value: { enabled: false, url: '' },
    },
    {
      key: ['ui-port', 'pipelines', 'notification-destinations', ['sub-1']],
      value: [
        {
          id: 'sub-1',
          key: 'aav9-process',
          description: '#aav9-process',
          status: 'active',
        },
      ],
    },
  ],
})

const withClient = (Story: () => React.ReactNode) => (
  <QueryClientProvider client={client}>
    <Story />
  </QueryClientProvider>
)

const inputs = [{ name: 'readings', required: true }]

const parameters = [
  { name: 'threshold', type: 'decimal' as const, required: true },
]

export const AddTrigger: Story = {
  decorators: [withClient],
  render: () => (
    <ScheduleDialog
      open
      onOpenChange={() => {}}
      definitionId="pl-1"
      workspaceId="ws-1"
      inputs={inputs}
      parameters={parameters}
    />
  ),
}

export const EditTrigger: Story = {
  decorators: [withClient],
  render: () => (
    <ScheduleDialog
      open
      onOpenChange={() => {}}
      schedule={schedule}
      definitionId="pl-1"
      workspaceId="ws-1"
      inputs={inputs}
      parameters={parameters}
    />
  ),
}

/** The runs a trigger started and the times it chose not to run. */
export const TriggerHistory: Story = {
  decorators: [withClient],
  render: () => (
    <ScheduleHistoryDialog
      open
      onOpenChange={() => {}}
      schedule={schedule}
      title="Every day at 06:30 (Europe/London)"
    />
  ),
}

export const WebhookOn: Story = {
  decorators: [withClient],
  render: () => <WebhookCard definitionId="pl-on" />,
}

export const WebhookOff: Story = {
  decorators: [withClient],
  render: () => <WebhookCard definitionId="pl-off" />,
}

export const Keeps: Story = {
  render: () => (
    <RunKeeps
      pipelineId="pl-1"
      config={{
        // SAFETY: RunKeeps reads only `config.output.mode`; this story names the dataset it would create and the card reads no schema version.
        output: { mode: 'create', datasetName: 'Plate reads' } as never,
      }}
    />
  ),
}

export const Actions: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <ElnActions
        config={{
          actions: [
            // SAFETY: ElnActions reads an action's `name`, `operation`, `mode` and `arguments.p_record_id`, which is exactly what this story supplies.
            {
              name: 'cite',
              operation: 'insert_block',
              arguments: { p_record_id: 'rec-1' },
              mode: 'propose',
            } as never,
          ],
        }}
      />
      <ElnActions config={{}} />
    </div>
  ),
}

export const Notifications: Story = {
  decorators: [withClient],
  render: () => (
    <RunNotifications
      config={{ notifications: [{ subscriptionId: 'sub-1' }] }}
    />
  ),
}
