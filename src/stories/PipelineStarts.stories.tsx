import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { HeardEvents } from '#/components/pipelines/starts/heard-events'
import { NextStarts } from '#/components/pipelines/starts/next-starts'
import {
  RunTimeline,
  TimelineLegend,
} from '#/components/pipelines/starts/run-timeline'
import { SelectedRun } from '#/components/pipelines/starts/selected-run'
import { StartsAside } from '#/components/pipelines/starts/starts-aside'
import { StartsComposer } from '#/components/pipelines/starts/starts-composer'
import { TestStartsDialog } from '#/components/pipelines/starts/test-starts-dialog'
import { ScheduleDialog } from '#/components/pipelines/schedule-dialog'
import { ScheduleHistoryDialog } from '#/components/pipelines/schedule-history'
import {
  ElnActions,
  RunKeeps,
  RunNotifications,
  WebhookCard,
} from '#/components/pipelines/triggers-outputs'
import { parseStartRules } from '#/lib/pipelines/start-rules'
import type {
  PipelineRunWire,
  PipelineScheduleActivityWire,
  PipelineScheduleWire,
} from '#/lib/pipelines/types'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The Starts and runs tab (`src/components/pipelines/starts/`): the starts
 * composer, what it reads as, the next starts, what the starts heard, the week
 * of runs with a run picked, the right-hand column and the 7-day test.
 *
 * Below those, the add/edit start dialog and one trigger's history, plus the cards that
 * say how a version starts and what it does when it ends: the incoming webhook,
 * what a run keeps, the ELN actions it takes and who hears about it. Reads are
 * seeded by query key; the webhook card's endpoint is a `fetch`, so its state
 * is seeded too and no story turns it on or off.
 */
const meta = {
  title: 'Pipelines/Starts and runs',
  parameters: {
    layout: 'centered',
    tanstack: {
      router: {
        route: screenRoutes('/pipelines/$pipelineId/starts', [
          '/pipelines/$pipelineId/steps',
          '/pipelines/$pipelineId/runs/$runId',
          '/pipelines/runs/$runId',
          '/pipelines/agents',
        ]),
        path: '/pipelines/$pipelineId/starts',
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

const rules = parseStartRules({
  window: { days: 'weekdays', from: '07:00', to: '19:00', timeZone: 'UTC' },
  minNewRows: 8,
  waitMinutes: 2,
})

const heard: PipelineScheduleActivityWire[] = [
  {
    ...activity[0],
    id: 'h-1',
    source: 'event',
    label: 'DS-0311 S-15',
    run_id: 'run-4',
    kind: 'started',
    message: '',
    detail: { joined: 1 },
  },
  { ...activity[1], id: 'h-2', source: 'webhook', label: null },
]

const startNow = new Date('2026-10-14T09:00:00.000Z')

const client = screenQueryClient({
  data: [
    {
      key: ['ui-port', 'pipelines', 'trigger-datasets'],
      value: new Map([['ds-1', 'Plate reads']]),
    },
    {
      key: ['ui-port', 'pipelines', 'webhook-trigger', 'pl-1'],
      value: { enabled: true, url: 'https://eln.example.com/hook' },
    },
    {
      key: ['ui-port', 'pipelines', 'run-prompts', 'run-3'],
      value: [],
    },
    { key: ['ui-port', 'pipelines', 'member-names'], value: {} },
    {
      key: ['ui-port', 'pipelines', 'run-manifest', 'run-4'],
      value: { sequence: 3, digest: 'a'.repeat(64), signed: true },
    },
    {
      key: ['ui-port', 'pipelines', 'run-manifest', 'run-3'],
      value: null,
    },
    { key: ['agent-actions', 'policies'], value: [] },
    { key: ['ui-port', 'pipelines', 'start-events', 'pl-1'], value: [] },
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

export const Composer: Story = {
  decorators: [withClient],
  render: () => (
    <StartsComposer
      pipelineId="pl-1"
      workspaceId="ws-1"
      schedules={[schedule]}
      rules={rules}
      declared={{ inputs: [], parameters: [] }}
      onDraft={() => {}}
    />
  ),
}

export const NextAndHeard: Story = {
  decorators: [withClient],
  render: () => (
    <div className="flex flex-col gap-4">
      <NextStarts
        schedules={[schedule]}
        rules={rules}
        now={startNow}
        timeZone="Europe/London"
        datasetNames={new Map()}
      />
      <HeardEvents
        rows={heard}
        pipelineId="pl-1"
        numbers={new Map([['run-4', 4]])}
        now={startNow}
        timeZone="Europe/London"
      />
    </div>
  ),
}

export const WeekOfRuns: Story = {
  decorators: [withClient],
  render: () => (
    <div className="flex flex-col gap-3">
      <TimelineLegend hasWindow />
      <RunTimeline
        runs={[runRow(3, 'failed'), runRow(4, 'succeeded')]}
        skips={[{ id: 'k-1', at: '2026-10-13T08:00:00.000Z' }]}
        numbers={
          new Map([
            ['run-3', 3],
            ['run-4', 4],
          ])
        }
        now={startNow}
        timeZone="UTC"
        window={rules.window}
        picked="run-3"
        onPick={() => {}}
      />
      <SelectedRun
        run={runRow(4, 'succeeded')}
        number={4}
        version="v1"
        heard="DS-0311 S-15"
        pipelineId="pl-1"
        workspaceId="ws-1"
      />
    </div>
  ),
}

export const RightColumn: Story = {
  decorators: [withClient],
  render: () => (
    <StartsAside workspaceId="ws-1" displayId="PL-0007" owner="Gareth P." />
  ),
}

export const TestTheRules: Story = {
  decorators: [withClient],
  render: () => (
    <TestStartsDialog
      rules={rules}
      schedules={[schedule]}
      workspaceId="ws-1"
      pipelineId="pl-1"
      now={startNow}
      onClose={() => {}}
    />
  ),
}
