import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RemoteJobPanel } from '#/components/pipelines/remote-job-panel'
import {
  LakehouseStepBody,
  RemoteJobStepBody,
} from '#/components/pipelines/step-list/remote-bodies'
import {
  LakehouseSqlSection,
  RemoteJobConnections,
} from '#/components/settings/remote-jobs'
import { remoteKeys } from '#/lib/pipelines/remote/client'
import type { RunRemoteJob } from '#/lib/pipelines/remote/client'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The two steps that reach outside the run: a script on an HPC queue and SQL
 * over the open tables (`src/components/pipelines/step-list/remote-bodies.tsx`),
 * the run page's waiting panel, and the stewards' settings for both. The
 * connections, tables and switch are seeded by key; nothing is sent anywhere.
 */
const meta = {
  title: 'Pipelines/Remote steps',
  parameters: {
    layout: 'centered',
    tanstack: {
      router: {
        route: screenRoutes('/pipelines/$pipelineId/steps', []),
        path: '/pipelines/$pipelineId/steps',
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

const client = screenQueryClient({
  data: [
    {
      key: [...remoteKeys.connections, 'ws-1'],
      value: [
        {
          id: 'c-1',
          key: 'campus-hpc',
          name: 'Campus HPC',
          status: 'active',
          baseUrl: 'https://slurm.example.org',
          user: 'sheetbase',
          callbackUrl: 'https://eln.example.org',
          queues: [
            { name: 'hpc-short', maxMinutes: 120 },
            { name: 'gpu.a100', maxMinutes: 1440 },
          ],
        },
      ],
    },
    {
      key: [...remoteKeys.lakehouse, 'ws-1'],
      value: { enabled: true, lakeEnabled: true, tableCount: 2 },
    },
    {
      key: [...remoteKeys.tables, 'ws-1'],
      value: [
        { name: 'batches', rows: 1200 },
        { name: 'plates', rows: 96 },
      ],
    },
  ],
})

const withClient = (Story: () => React.ReactNode) => (
  <QueryClientProvider client={client}>
    <Story />
  </QueryClientProvider>
)

const job: RunRemoteJob = {
  id: 'job-1',
  step_name: 'align',
  connection_key: 'campus-hpc',
  queue: 'hpc-short',
  external_job_id: '48213',
  state: 'running',
  reason: null,
  message: null,
  limit_minutes: 120,
  deadline_at: '2026-09-25T10:40:00Z',
  result_rows: null,
  submitted_at: '2026-09-25T08:41:00Z',
  finished_at: null,
}

export const RemoteJobStep: Story = {
  decorators: [withClient],
  render: () => (
    <RemoteJobStepBody
      step={{
        name: 'align',
        kind: 'remote_job',
        remoteJob: {
          connection: 'campus-hpc',
          queue: 'hpc-short',
          script: 'python align.py "$SHEETBASE_INPUT_URL"',
          limitMinutes: 60,
        },
      }}
      index={1}
      workspaceId="ws-1"
      onChange={() => undefined}
    />
  ),
}

export const LakehouseStep: Story = {
  decorators: [withClient],
  render: () => (
    <LakehouseStepBody
      step={{
        name: 'batches',
        kind: 'lakehouse',
        statement: 'SELECT * FROM batches LIMIT 100',
        lake: { tables: ['batches'] },
      }}
      index={0}
      workspaceId="ws-1"
      onChange={() => undefined}
    />
  ),
}

export const WaitingPanel: Story = {
  render: () => <RemoteJobPanel jobs={[job]} />,
}

export const FailedPanel: Story = {
  render: () => (
    <RemoteJobPanel
      jobs={[
        {
          ...job,
          state: 'failed',
          reason: 'limit',
          message: 'Stopped after 120 minutes.',
          finished_at: '2026-09-25T10:42:00Z',
        },
      ]}
    />
  ),
}

export const ConnectionSettings: Story = {
  decorators: [withClient],
  render: () => <RemoteJobConnections workspaceId="ws-1" canManage />,
}

export const LakehouseSwitch: Story = {
  decorators: [withClient],
  render: () => <LakehouseSqlSection workspaceId="ws-1" canManage dataAccess />,
}
