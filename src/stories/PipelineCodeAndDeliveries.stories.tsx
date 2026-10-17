import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  PipelineSteps,
  TemporaryArtefact,
  TemporaryResultNote,
} from '#/components/v3/pipelines/pipeline-code'
import type { PipelineStepConfig } from '#/components/v3/pipelines/pipeline-code'
import { RunDeliveriesPanel } from '#/components/v3/pipelines/run-deliveries'
import type { PipelineRunDeliveryWire } from '#/components/v3/pipelines/pipelines-data'
import { screenRoutes } from './screen-stories'

/**
 * Pipeline code and run notifications (`src/components/v3/pipelines/`).
 *
 * `pipeline-code.tsx` renders a stored step's statement as text — never
 * interpreted — and states what happens to an intermediate result: its table
 * exists only while the run is going. `run-deliveries.tsx` reads the run's real
 * delivery rows and, when there are none, says which of the three reasons
 * applies to *this* run rather than showing an empty table.
 *
 * Both are prop-driven, so these stories are their real inputs rather than a
 * seeded read.
 */
const meta = {
  title: 'Pipelines/Code and deliveries',
  parameters: {
    tanstack: {
      router: {
        // `PipelineSteps` links to the step editor.
        route: screenRoutes('/pipelines/$pipelineId/steps'),
        path: '/pipelines/$pipelineId/steps',
        params: { pipelineId: 'pl-1' },
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[820px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const steps: PipelineStepConfig[] = [
  {
    name: 'normalise-plate',
    language: 'sql',
    statement:
      'select well, sample_id, round(value::numeric, 6) as value\nfrom raw_plate_readings\nwhere value is not null',
  },
  {
    name: 'flag-outliers',
    language: 'python',
    statement:
      'mean = values.mean()\nfor well, value in values.items():\n    if abs(value - mean) > 3 * values.std():\n        flags.append((well, "high_cv"))',
  },
]

/** The stored statements in run order, with what happens to each result. */
export const Steps: Story = {
  render: () => <PipelineSteps pipelineId="pl-1" steps={steps} />,
}

/** A pipeline with no steps stored yet: the block renders nothing to read. */
export const StepsEmpty: Story = {
  render: () => <PipelineSteps pipelineId="pl-1" steps={[]} />,
}

/** The temporary-store badge on its own, as the artefact row renders it. */
export const TemporaryStore: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <TemporaryArtefact>Intermediate table</TemporaryArtefact>
      <TemporaryResultNote />
    </div>
  ),
}

function delivery(
  overrides: Partial<PipelineRunDeliveryWire> = {},
): PipelineRunDeliveryWire {
  return {
    id: 'd-1',
    subscription_id: 'sub-00000001',
    event_type: 'pipeline.run.succeeded',
    status: 'delivered',
    attempt: 1,
    response_status: 200,
    error_code: null,
    error_message: null,
    delivered_at: '2026-10-02T10:13:00.000Z',
    created_at: '2026-10-02T10:12:50.000Z',
    destination: { key: 'aav9-process', description: '#aav9-process' },
    ...overrides,
  }
}

/** One delivery per destination, including one that failed after retries. */
export const Deliveries: Story = {
  render: () => (
    <RunDeliveriesPanel
      runStatus="succeeded"
      queuedCount={3}
      deliveries={[
        delivery(),
        delivery({
          id: 'd-2',
          subscription_id: 'sub-00000002',
          status: 'retrying',
          attempt: 2,
          delivered_at: null,
          destination: { key: 'qc-lims', description: null },
        }),
        delivery({
          id: 'd-3',
          subscription_id: 'sub-00000003',
          status: 'dead_letter',
          attempt: 4,
          response_status: 502,
          error_code: 'webhook_unreachable',
          error_message: 'The endpoint did not accept the payload.',
          delivered_at: null,
          destination: { key: 'stability-team', description: null },
        }),
      ]}
    />
  ),
}

/**
 * The three empty reasons, each true of its own run status: a run that has not
 * finished has not queued anything yet, a succeeded run configured none, and a
 * failed run does not notify.
 */
export const NoDeliveries: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <RunDeliveriesPanel runStatus="running" queuedCount={0} deliveries={[]} />
      <RunDeliveriesPanel
        runStatus="succeeded"
        queuedCount={0}
        deliveries={[]}
      />
      <RunDeliveriesPanel runStatus="failed" queuedCount={0} deliveries={[]} />
    </div>
  ),
}

/** Queued deliveries the workspace cannot read are counted, not hidden. */
export const DeliveriesUnreadable: Story = {
  render: () => (
    <RunDeliveriesPanel
      runStatus="succeeded"
      queuedCount={2}
      deliveries={[delivery()]}
    />
  ),
}

export const DeliveriesLoading: Story = {
  render: () => (
    <RunDeliveriesPanel
      runStatus="succeeded"
      queuedCount={1}
      deliveries={[]}
      isLoading
    />
  ),
}
