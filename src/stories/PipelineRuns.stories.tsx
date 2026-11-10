import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AddRunToNotebook } from '#/components/pipelines/add-run-to-notebook'
import { AiPipelineBox } from '#/components/pipelines/ai-pipeline-box'
import { RunAiFix } from '#/components/pipelines/run-ai-fix'
import { RunDialog } from '#/components/pipelines/run-dialog'
import { RunLog } from '#/components/pipelines/run-log'
import { RunResult } from '#/components/pipelines/run-result'
import { RunStepsRail } from '#/components/pipelines/run-steps-rail'
import { PageAiWorkspaceProvider } from '#/lib/use-page-ai'
import type {
  PipelineDefinitionVersionWire,
  PipelineRunLogWire,
  PipelineRunOutputWire,
} from '#/lib/pipelines/types'
import type { RunStep } from '#/lib/pipelines/run-steps'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Pipeline runs and AI help (`src/components/pipelines/`).
 *
 * The run page's parts (steps rail, log, result), the "Run with…" dialog, the
 * citation button, and the two AI controls that need a live model: describing
 * a pipeline in words, and explaining a failed run. The AI controls render
 * nothing unless the workspace's AI settings say a real model is connected, so
 * those settings are seeded by key; no call to a model is made, because no
 * story presses a button that would.
 */
const meta = {
  title: 'Pipelines/Runs',
  parameters: {
    layout: 'centered',
    tanstack: {
      router: {
        route: screenRoutes('/pipelines/runs/$runId', [
          '/pipelines/$pipelineId/steps',
          '/datasets/$datasetId',
          '/datasets/$datasetId/snapshots',
          '/experiments/$expId/notebook',
        ]),
        path: '/pipelines/runs/$runId',
        params: { runId: 'run-1' },
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

const choices = [
  {
    id: 'dv-1',
    label: 'Plate reads: DS-0012 — v3 (2026-10-02)',
    schemaId: 'sch-1',
    schemaName: 'Plate reader',
  },
]

const aiLive = {
  workspaceId: 'ws-1',
  readiness: {
    ready: true,
    mode: 'provider',
    profileId: 'p-1',
    dataClass: 'cloud',
  },
}

const client = screenQueryClient({
  data: [
    {
      key: ['ui-port', 'pipelines', 'dataset-version-choices'],
      value: choices,
    },
    { key: ['ai-settings', 'ws-1'], value: aiLive },
  ],
})

const withClient = (Story: () => React.ReactNode) => (
  <QueryClientProvider client={client}>
    <PageAiWorkspaceProvider value="ws-1">
      <Story />
    </PageAiWorkspaceProvider>
  </QueryClientProvider>
)

const version: PipelineDefinitionVersionWire = {
  id: 'ver-1',
  definition_id: 'pl-1',
  workspace_id: 'ws-1',
  version: 3,
  lifecycle: 'published',
  configuration_format_version: 1,
  configuration: {
    inputs: [{ name: 'readings', required: true, schemaId: 'sch-1' }],
    parameters: [
      { name: 'threshold', type: 'decimal', required: true },
      { name: 'plate', type: 'text', required: false, default: 'P-01' },
    ],
  },
  revision: 4,
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-01T09:00:00.000Z',
  created_by_user_id: 'u-1',
  published_at: '2026-10-01T09:30:00.000Z',
  published_by_user_id: 'u-1',
  retired_at: null,
  retired_by_user_id: null,
}

/** "Run with…": pick a dataset version per input and give each parameter. */
export const RunWith: Story = {
  decorators: [withClient],
  render: () => (
    <RunDialog
      pipelineName="Normalise plate reads"
      version={version}
      busy={false}
      onClose={() => {}}
      onSubmit={() => {}}
    />
  ),
}

/** The same dialog for "Try draft": it promises nothing is kept. */
export const TryDraftDialog: Story = {
  decorators: [withClient],
  render: () => (
    <RunDialog
      pipelineName="Normalise plate reads"
      version={version}
      busy={false}
      trial
      initial={{
        inputVersions: { readings: 'dv-1' },
        parameters: { threshold: 'x' },
      }}
      onClose={() => {}}
      onSubmit={() => {}}
    />
  ),
}

const steps: RunStep[] = [
  {
    index: 1,
    name: 'transform',
    label: 'Transform',
    kind: 'SQL',
    state: 'done',
    note: 'SQL',
  },
  {
    index: 2,
    name: 'check_units',
    label: 'Check units',
    kind: 'Python',
    state: 'failed',
    note: 'Python · stopped here',
  },
  {
    index: 3,
    name: 'confirm',
    label: 'Confirm outliers',
    kind: 'SQL',
    state: 'waiting',
    note: 'Waiting for a person',
  },
  {
    index: 4,
    name: 'tidy',
    label: 'Tidy',
    kind: 'SQL',
    state: 'not_started',
    note: 'Not started',
  },
]

export const StepsRail: Story = {
  render: () => <RunStepsRail steps={steps} />,
}

function log(
  sequence: number,
  overrides: Partial<PipelineRunLogWire>,
): PipelineRunLogWire {
  return {
    id: `log-${sequence}`,
    workspace_id: 'ws-1',
    run_id: 'run-1',
    sequence,
    level: 'info',
    stage: 'transform',
    message: 'Ran the transform',
    detail: {},
    at: '2026-10-02T10:12:0' + sequence + '.000Z',
    ...overrides,
  }
}

/** The log, with a Python step's output and environment under its line. */
export const Log: Story = {
  render: () => (
    <RunLog
      logs={[
        log(1, { stage: 'start', message: 'Started the run' }),
        log(2, { level: 'warning', message: '3 rows had no value' }),
        log(3, {
          stage: 'check_units',
          level: 'error',
          message: 'The step failed',
          detail: {
            step: 'check_units',
            line: 4,
            logs: ['checking 96 rows', 'unit mismatch in column od600'],
            environment: { python: '3.12.8', packages: { pandas: '2.2.3' } },
          },
        }),
      ]}
    />
  ),
}

export const LogEmpty: Story = { render: () => <RunLog logs={[]} /> }

const run = {
  result: {
    resultPreview: {
      columns: ['well', 'od600'],
      rows: [
        ['A1', 0.412],
        ['A2', 0.398],
      ],
      rowCount: 96,
      truncated: true,
    },
  },
}

const output: PipelineRunOutputWire = {
  id: 'o-1',
  workspace_id: 'ws-1',
  run_id: 'run-1',
  dataset_id: 'ds-1',
  dataset_version_id: 'dv-9',
  label: 'Run 41',
  created_at: '2026-10-02T10:13:00.000Z',
}

/** A run that kept its result: the rows, then the dataset it was written to. */
export const Result: Story = {
  render: () => (
    <RunResult
      run={run}
      pipelineId="pl-1"
      outputs={[output]}
      datasetNames={{ 'ds-1': 'Normalised plate reads' }}
    />
  ),
}

/** A run that keeps nothing says so, and where to change that. */
export const ResultNotKept: Story = {
  render: () => (
    <RunResult run={run} pipelineId="pl-1" outputs={[]} datasetNames={{}} />
  ),
}

/** The citation button; the picker opens on click. */
export const AddToNotebook: Story = {
  decorators: [withClient],
  render: () => (
    <AddRunToNotebook
      paragraphs={[
        // SAFETY: the citation reads a paragraph's `text` through its plain-text extractor, which is all this story's paragraph carries.
        { text: 'Normalise plate reads ran on 2 October.' } as never,
      ]}
    />
  ),
}

/** The failed-run helper, ready to ask for an explanation. */
export const AiFix: Story = {
  decorators: [withClient],
  render: () => (
    <RunAiFix
      pipelineId="pl-1"
      errorCode="sql_error"
      errorMessage='column "od6OO" does not exist'
      logLines={['column "od6OO" does not exist']}
      failedStep="Transform"
      runConfig={{}}
      draft={undefined}
    />
  ),
}

/** Describing a pipeline in plain words; the draft card appears after asking. */
export const AiBox: Story = {
  decorators: [withClient],
  render: () => (
    <AiPipelineBox
      current={{ inputs: [], steps: [] }}
      onApply={async () => {}}
    />
  ),
}
