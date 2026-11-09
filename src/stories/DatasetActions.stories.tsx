import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'

import { ColumnInspector } from '#/components/datasets/column-inspector'
import { CiteSnapshotDialog } from '#/components/datasets/cite-snapshot-dialog'
import { DatasetArchive } from '#/components/datasets/dataset-archive'
import {
  DatasetInspector,
  DatasetIssueActions,
} from '#/components/datasets/dataset-inspector'
import {
  DatasetModelUpgrade,
  datasetModelPositionKey,
} from '#/components/datasets/dataset-model-upgrade'
import { DatasetRunPipeline } from '#/components/datasets/dataset-run-pipeline'
import type { DatasetListRow } from '#/components/datasets/datasets-data'
import type { SnapshotVersion } from '#/components/datasets/snapshot-data'
import { pipelineDataQueryKeys } from '#/components/pipelines/pipelines-data'
import type { PipelineListRow } from '#/components/pipelines/pipelines-data'
import { Inspector } from '#/components/ui/layout'
import { datasetFlagsQueryKeys } from '#/lib/dataset-flags'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import {
  screenQueryClient,
  screenRoutes,
  stubDataClient,
  withApiReads,
} from './screen-stories'

/**
 * The dataset page's actions and panels that sit beside the grid
 * (`src/components/datasets/`): the list inspector and its issue buttons, the
 * column panel, archive and restore, the move to a newer model version, "Run
 * pipeline…" and citing a snapshot in a notebook. Each is shown at rest and in
 * the state that changes what it offers.
 */
const DATASET_ID = '0198d970-e266-4000-8000-000000000d01'

const meta = {
  title: 'Datasets/Actions and panels',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/datasets', [
          '/datasets/$datasetId',
          '/datasets/$datasetId/rows',
          '/models',
          '/import',
          '/experiments/$expId/notebook',
        ]),
        path: '/datasets',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const clean: DatasetListRow = {
  id: 'DS-0042',
  uuid: DATASET_ID,
  name: 'Titre by train',
  model: 'Bioreactor titre',
  projectId: null,
  createdByUserId: null,
  rows: 1240,
  issues: 0,
  outOfRange: 0,
  missingUnit: 0,
  missingUnitFields: [],
  experimentId: 'EXP-0117',
  reviewState: null,
  updated: '2 days ago',
  updatedAt: '2026-11-03T09:30:00Z',
  archived: false,
}

const withIssues: DatasetListRow = {
  ...clean,
  issues: 3,
  outOfRange: 1,
  missingUnit: 2,
  missingUnitFields: ['Viable cell density', 'Glucose'],
  reviewState: 'in_review',
}

function client(data: Parameters<typeof screenQueryClient>[0]) {
  return screenQueryClient(data)
}

function inside(queryClient: QueryClient, width = 360) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ width }} className="max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

// --- Dataset list inspector -------------------------------------------------

export const InspectorValid: Story = {
  render: () => <DatasetInspector dataset={clean} />,
  decorators: [inside(client({}))],
}

export const InspectorWithIssues: Story = {
  render: () => <DatasetInspector dataset={withIssues} />,
  decorators: [inside(client({}))],
}

export const IssueActions: Story = {
  render: () => <DatasetIssueActions dataset={withIssues} />,
  decorators: [inside(client({}))],
}

export const NoIssueActions: Story = {
  render: () => (
    <div data-testid="issue-actions">
      <DatasetIssueActions dataset={clean} />
      <p className="m-0 text-label text-fg-muted">
        Nothing is wrong, so no action is offered.
      </p>
    </div>
  ),
  decorators: [inside(client({}))],
}

// --- Column inspector -------------------------------------------------------

const column = {
  field_id: 'f-vcd',
  key: 'vcd',
  label: 'Viable cell density',
  logical_type: 'decimal',
}

const otherColumn = {
  ...column,
  field_id: 'f-glc',
  key: 'glc',
  label: 'Glucose',
}

const missingUnitFlag = (fieldId: string): DatasetValueFlag => ({
  id: `flag-${fieldId}`,
  datasetId: DATASET_ID,
  rowId: 'r1',
  fieldId,
  kind: 'missing_unit',
  reason: 'No unit on this column',
  comment: null,
  setAt: '2026-11-03T09:30:00Z',
})

function columnClient(unit: string | null) {
  return client({
    data: [
      {
        key: ['ui-port', 'dataset-column-unit', DATASET_ID, column.key],
        value: { unit },
      },
    ],
  })
}

export const ColumnWithUnit: Story = {
  render: () => (
    <Inspector aria-label="Column">
      <ColumnInspector
        datasetId={DATASET_ID}
        field={column}
        values={[1.2, 3.4, 8.9]}
        rowCount={3}
        flags={[]}
        fields={[column]}
        canWrite
      />
    </Inspector>
  ),
  decorators: [inside(columnClient('10^6 cells/mL'))],
}

export const ColumnMissingUnit: Story = {
  render: () => (
    <Inspector aria-label="Column">
      <ColumnInspector
        datasetId={DATASET_ID}
        field={column}
        values={[1.2, 3.4, 8.9]}
        rowCount={3}
        flags={[missingUnitFlag(column.field_id), missingUnitFlag('f-glc')]}
        fields={[column, otherColumn]}
        canWrite
      />
    </Inspector>
  ),
  decorators: [inside(columnClient(null))],
}

export const ColumnMissingUnitReadOnly: Story = {
  render: () => (
    <Inspector aria-label="Column">
      <ColumnInspector
        datasetId={DATASET_ID}
        field={column}
        values={[]}
        rowCount={0}
        flags={[]}
        fields={[column]}
        canWrite={false}
      />
    </Inspector>
  ),
  decorators: [inside(columnClient(null))],
}

// --- Archive and restore ----------------------------------------------------

const archiveClient = client({
  data: [
    {
      key: datasetFlagsQueryKeys.active(DATASET_ID),
      value: [],
    },
  ],
})

export const ArchiveAction: Story = {
  render: () => (
    <DatasetArchive
      datasetId={DATASET_ID}
      name="Titre by train"
      archived={false}
      canEdit
    />
  ),
  decorators: [inside(archiveClient, 240)],
}

export const ArchiveDialog: Story = {
  render: () => (
    <DatasetArchive
      datasetId={DATASET_ID}
      name="Titre by train"
      archived={false}
      canEdit
      open
      onOpenChange={() => {}}
    />
  ),
  decorators: [inside(archiveClient, 240)],
}

export const ArchiveDialogRefused: Story = {
  render: () => (
    <DatasetArchive
      datasetId={DATASET_ID}
      name="Titre by train"
      archived={false}
      canEdit
      client={stubDataClient()}
      open
      onOpenChange={() => {}}
    />
  ),
  decorators: [inside(archiveClient, 240)],
  play: async () => {
    // The stub answers no read, so confirming shows the refusal inline.
    await userEvent.click(
      await screen.findByRole('button', { name: 'Archive' }),
    )
    await expect(await screen.findByRole('alert')).toBeInTheDocument()
  },
}

export const RestoreAction: Story = {
  render: () => (
    <DatasetArchive
      datasetId={DATASET_ID}
      name="Titre by train"
      archived
      canEdit
    />
  ),
  decorators: [inside(archiveClient, 240)],
}

export const ArchiveHiddenWithoutEdit: Story = {
  render: () => (
    <div>
      <DatasetArchive
        datasetId={DATASET_ID}
        name="Titre by train"
        archived={false}
        canEdit={false}
      />
      <p className="m-0 text-label text-fg-muted">
        A viewer is offered nothing to archive.
      </p>
    </div>
  ),
  decorators: [inside(archiveClient, 320)],
}

// --- Model upgrade ----------------------------------------------------------

const position = {
  datasetRevision: 7,
  currentVersionId: 'sv-2',
  currentVersion: 2,
  newer: [{ id: 'sv-3', version: 3 }],
}

const previewKey = (target: string) =>
  ['ui-port', 'dataset-model-preview', DATASET_ID, target] as const

const preview = {
  ok: true,
  blocked: false,
  reason: null,
  fromVersion: 2,
  toVersion: 3,
  toVersionId: 'sv-3',
  added: [{ key: 'osmolality', label: 'Osmolality', type: 'decimal' }],
  removed: [],
  retyped: [],
  requiredWithoutDefault: [],
  semanticChanges: [],
  rowCount: 1240,
  datasetRevision: 7,
}

export const ModelUpgradeAvailable: Story = {
  render: () => (
    <DatasetModelUpgrade
      datasetId={DATASET_ID}
      canEdit
      client={stubDataClient()}
    />
  ),
  decorators: [
    inside(
      client({
        data: [
          { key: datasetModelPositionKey(DATASET_ID), value: position },
          { key: previewKey('sv-3'), value: preview },
        ],
      }),
      240,
    ),
  ],
}

export const ModelUpgradePreview: Story = {
  ...ModelUpgradeAvailable,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /available/i }),
    )
    await expect(await screen.findByText(/Adds Osmolality/)).toBeInTheDocument()
  },
}

export const ModelUpgradeBlocked: Story = {
  render: () => (
    <DatasetModelUpgrade
      datasetId={DATASET_ID}
      canEdit
      client={stubDataClient()}
    />
  ),
  decorators: [
    inside(
      client({
        data: [
          { key: datasetModelPositionKey(DATASET_ID), value: position },
          {
            key: previewKey('sv-3'),
            value: {
              ...preview,
              blocked: true,
              reason:
                'A field changed meaning, so existing values cannot carry over.',
              semanticChanges: [{ key: 'vcd', label: 'Viable cell density' }],
            },
          },
        ],
      }),
      240,
    ),
  ],
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /available/i }),
    )
    await expect(
      await screen.findByText(/cannot carry over/),
    ).toBeInTheDocument()
  },
}

export const ModelUpgradeNothingNewer: Story = {
  render: () => (
    <div>
      <DatasetModelUpgrade
        datasetId={DATASET_ID}
        canEdit
        client={stubDataClient()}
      />
      <p className="m-0 text-label text-fg-muted">
        The dataset is on the newest version, so the control renders nothing.
      </p>
    </div>
  ),
  decorators: [
    inside(
      client({
        data: [
          {
            key: datasetModelPositionKey(DATASET_ID),
            value: { ...position, newer: [] },
          },
        ],
      }),
      320,
    ),
  ],
}

// --- Run pipeline -----------------------------------------------------------

const pipeline: PipelineListRow = {
  id: 'pl-1',
  workspace_id: 'ws-1',
  key: 'titre_summary',
  display_id: 'PL-0007',
  name: 'Titre summary',
  description: null,
  lifecycle: 'active',
  revision: 1,
  created_at: '2026-10-01T09:00:00Z',
  updated_at: '2026-10-01T09:00:00Z',
  created_by_user_id: null,
  updated_by_user_id: null,
  versions: [],
  current: {
    id: 'plv-1',
    definition_id: 'pl-1',
    workspace_id: 'ws-1',
    version: 2,
    lifecycle: 'published',
    configuration_format_version: 1,
    configuration: {
      inputs: [{ name: 'titre', kind: 'dataset' }],
      parameters: [],
    },
    revision: 1,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    created_by_user_id: null,
    published_at: '2026-10-01T09:00:00Z',
    published_by_user_id: null,
    retired_at: null,
    retired_by_user_id: null,
  },
  draft: undefined,
  runCount: 4,
  lastRun: undefined,
}

const pipelineClient = (rows: PipelineListRow[]) =>
  client({ data: [{ key: pipelineDataQueryKeys.list, value: rows }] })

export const RunPipelineAvailable: Story = {
  render: () => (
    <DatasetRunPipeline workspaceId="ws-1" latestVersionId="dv-9" />
  ),
  decorators: [inside(pipelineClient([pipeline]), 240)],
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /Run pipeline/ }),
    )
    await expect(await screen.findByText('Titre summary')).toBeInTheDocument()
  },
}

export const RunPipelineNeedsSnapshot: Story = {
  render: () => (
    <DatasetRunPipeline workspaceId="ws-1" latestVersionId={null} />
  ),
  decorators: [inside(pipelineClient([pipeline]), 240)],
  play: RunPipelineAvailable.play,
}

export const RunPipelineNoCandidates: Story = {
  render: () => (
    <div>
      <DatasetRunPipeline workspaceId="ws-1" latestVersionId="dv-9" />
      <p className="m-0 text-label text-fg-muted">
        No pipeline reads a dataset, so the control renders nothing.
      </p>
    </div>
  ),
  decorators: [inside(pipelineClient([]), 320)],
}

// --- Cite a snapshot --------------------------------------------------------

const snapshot: SnapshotVersion = {
  id: 'dv-9',
  label: 'v9',
  createdAt: '2026-11-03T09:30:00Z',
  createdByUserId: null,
  createdByCredentialId: null,
  createdByName: 'Ada Okafor',
  sourceDatasetRevision: 7,
  rowCount: 1240,
  contentHash: 'sha256:3f2a9c0d41b7',
  rowsRemovedAt: null,
  change: null,
  retention: { reason: 'kept', keptUntil: null },
  source: null,
  citedBy: { signedRevisions: [], pipelineRuns: [], analyses: [] },
}

export const CiteSnapshot: Story = {
  render: () => (
    <CiteSnapshotDialog
      datasetId={DATASET_ID}
      snapshot={snapshot}
      onClose={() => {}}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      client({
        data: [
          {
            key: ['ui-port', 'dataset-cite-identity', DATASET_ID],
            value: {
              id: DATASET_ID,
              name: 'Titre by train',
              display_id: 'DS-0042',
            },
          },
        ],
      }),
    ),
  ],
}
