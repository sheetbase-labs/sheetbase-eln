import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  PrintLabelsDialog,
  SampleLabelSheet,
} from '#/components/samples/sample-label-sheet'
import {
  ReleaseChecksPanel,
  ReleaseChecksSummary,
} from '#/components/samples/release-checks-panel'
import { SampleInspector } from '#/components/samples/sample-inspector'
import { SampleWorkflowPanel } from '#/components/samples/sample-workflow-panel'
import { sampleQueryKeys } from '#/lib/samples'
import type { SampleReleaseCheckStatus } from '#/lib/samples'
import type { WorkflowEvent, WorkflowRun } from '#/lib/sample-workflows'
import { holdRead, screenQueryClient, screenRoutes } from './screen-stories'
import { SAMPLE_ID, sampleFixture } from './sample-fixtures'

/**
 * The panels on a sample's own screens (`src/components/samples/`): the
 * registry inspector, the workflow panel, the release checks and the batch
 * label sheet. Reads are seeded under the keys the components use.
 */
const meta = {
  title: 'Samples/Record panels',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/samples', [
          '/samples/$sampleId',
          '/samples/$sampleId/lineage',
          '/samples/$sampleId/measurements',
          '/readings/new',
          '/experiments/$expId',
        ]),
        path: '/samples',
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[420px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const sample = sampleFixture()
const noop = () => {}

// --- Inspector --------------------------------------------------------------

const inspectorClient = screenQueryClient({
  data: [
    {
      key: ['ui-port', 'sample-inspector', 'lineage', SAMPLE_ID],
      value: { nodes: [], edges: [] },
    },
    {
      key: ['ui-port', 'sample-inspector', 'citations', SAMPLE_ID],
      value: [
        { id: 'exp-1', identifier: 'EXP-0142', title: 'Depth filtration' },
      ],
    },
  ],
})

/** The registry's right-hand panel: key properties, derived samples, citing experiments. */
export const Inspector: Story = {
  render: () => (
    <QueryClientProvider client={inspectorClient}>
      <SampleInspector sample={sample} />
    </QueryClientProvider>
  ),
}

const loadingInspector = screenQueryClient()

holdRead(loadingInspector, [
  'ui-port',
  'sample-inspector',
  'lineage',
  SAMPLE_ID,
])

/** Lineage still reading: the panel says so rather than claiming nothing was made. */
export const InspectorReadingLineage: Story = {
  render: () => (
    <QueryClientProvider client={loadingInspector}>
      <SampleInspector sample={sample} />
    </QueryClientProvider>
  ),
}

// --- Workflow ---------------------------------------------------------------

const run: WorkflowRun = {
  id: 'run-1',
  workflowId: 'wf-1',
  workflowName: 'Harvest release',
  stageId: 'st-2',
  stageName: 'Awaiting QC result',
  enteredAt: '2026-09-22T09:00:00.000Z',
  dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  completedAt: null,
  moves: [
    { id: 'st-3', name: 'Released', requiredFields: [] },
    { id: 'st-4', name: 'Rejected', requiredFields: ['notes'] },
  ],
}

const events: WorkflowEvent[] = [
  {
    id: 'ev-2',
    from: 'Received',
    to: 'Awaiting QC result',
    notes: 'Sent to QC',
    actor: 'Dana Whitfield',
    at: '2026-09-22T09:00:00.000Z',
    automation: [],
  },
  {
    id: 'ev-1',
    from: null,
    to: 'Received',
    notes: null,
    actor: 'Dana Whitfield',
    at: '2026-09-20T08:00:00.000Z',
    automation: [
      { kind: 'set_field', outcome: 'done', message: 'Location set' },
    ],
  },
]

const workflowClient = screenQueryClient({
  data: [
    { key: ['sample-workflow-runs', SAMPLE_ID], value: [run] },
    { key: ['sample-workflow-events', SAMPLE_ID], value: events },
    {
      key: ['sample-workflows-startable', 'Cell harvest'],
      value: [{ id: 'wf-2', name: 'Stability pull' }],
    },
  ],
})

const idleWorkflowClient = screenQueryClient({
  data: [
    { key: ['sample-workflow-runs', SAMPLE_ID], value: [] },
    { key: ['sample-workflow-events', SAMPLE_ID], value: [] },
    {
      key: ['sample-workflows-startable', 'Cell harvest'],
      value: [{ id: 'wf-1', name: 'Harvest release' }],
    },
  ],
})

/** A sample partway through a workflow: due date, next steps and history. */
export const Workflow: Story = {
  render: () => (
    <QueryClientProvider client={workflowClient}>
      <SampleWorkflowPanel
        sampleId={SAMPLE_ID}
        sampleType="Cell harvest"
        canMove
      />
    </QueryClientProvider>
  ),
}

/** In no workflow yet: the ones that fit the sample's type are offered. */
export const WorkflowStartable: Story = {
  render: () => (
    <QueryClientProvider client={idleWorkflowClient}>
      <SampleWorkflowPanel
        sampleId={SAMPLE_ID}
        sampleType="Cell harvest"
        canMove
      />
    </QueryClientProvider>
  ),
}

/** Read-only viewer: the step and history show, with no moves offered. */
export const WorkflowReadOnly: Story = {
  render: () => (
    <QueryClientProvider client={workflowClient}>
      <SampleWorkflowPanel
        sampleId={SAMPLE_ID}
        sampleType="Cell harvest"
        canMove={false}
      />
    </QueryClientProvider>
  ),
}

// --- Release checks ---------------------------------------------------------

const failing: SampleReleaseCheckStatus = {
  passed: false,
  ruleCount: 2,
  failedCount: 1,
  checks: [
    {
      key: 'viability',
      label: 'Viability at least 90 %',
      kind: 'min',
      passed: true,
      detail: null,
    },
    {
      key: 'endotoxin',
      label: 'Endotoxin below 5 EU/mL',
      kind: 'max',
      passed: false,
      detail: 'Latest reading 7.2 EU/mL',
    },
  ],
}

/** One check not met: the reason and where to record the missing value. */
export const ReleaseChecksFailing: Story = {
  render: () => (
    <ReleaseChecksSummary
      status={failing}
      sampleId={SAMPLE_ID}
      measurementCount={2}
    />
  ),
}

/** Every check passes: the sample can be released. */
export const ReleaseChecksPassing: Story = {
  render: () => (
    <ReleaseChecksSummary
      status={{
        passed: true,
        ruleCount: 1,
        failedCount: 0,
        checks: [{ ...failing.checks[0] }],
      }}
      sampleId={SAMPLE_ID}
      measurementCount={2}
    />
  ),
}

/** Checks over no data pass by default, which is not the same as checked. */
export const ReleaseChecksNotCheckedYet: Story = {
  render: () => (
    <ReleaseChecksSummary
      status={{
        passed: true,
        ruleCount: 1,
        failedCount: 0,
        checks: [{ ...failing.checks[0] }],
      }}
      sampleId={SAMPLE_ID}
      measurementCount={0}
    />
  ),
}

/** No rules apply to this sample. */
export const ReleaseChecksNone: Story = {
  render: () => (
    <ReleaseChecksSummary
      status={{ passed: true, ruleCount: 0, failedCount: 0, checks: [] }}
      sampleId={SAMPLE_ID}
    />
  ),
}

const checksClient = screenQueryClient({
  data: [{ key: sampleQueryKeys.releaseChecks(SAMPLE_ID), value: failing }],
})

/** The live panel, with its read answered from the seeded cache. */
export const ReleaseChecksLive: Story = {
  render: () => (
    <QueryClientProvider client={checksClient}>
      <ReleaseChecksPanel sampleId={SAMPLE_ID} measurementCount={2} />
    </QueryClientProvider>
  ),
}

// --- Labels -----------------------------------------------------------------

const labelRecords = [1, 2, 3].map((n) => ({
  ...sample,
  id: `s-${n}`,
  identifier: `SMP-223${n}`,
}))

const labelClient = screenQueryClient({
  data: [{ key: ['label-templates', 'picker'], value: [] }],
})

/** The batch dialog: how many labels, then print. The sheet itself is print-only. */
export const PrintLabels: Story = {
  render: () => (
    <QueryClientProvider client={labelClient}>
      <PrintLabelsDialog
        open
        onOpenChange={noop}
        records={labelRecords}
        scope="the 3 samples shown"
      />
    </QueryClientProvider>
  ),
}

/** The print-only sheet is portalled and hidden on screen; this renders it for the print view. */
export const LabelSheet: Story = {
  render: () => (
    <div className="text-label text-fg-muted">
      <SampleLabelSheet records={labelRecords} host="sheetbase.example" />
      The label sheet is hidden on screen and shown only when printing.
    </div>
  ),
}
