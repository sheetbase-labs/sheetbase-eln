import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DatasetHistoryTab } from '#/components/v3/datasets/dataset-history-tab'
import { DatasetImportsTab } from '#/components/v3/datasets/dataset-imports-tab'
import { DatasetUsedByTab } from '#/components/v3/datasets/dataset-used-by-tab'
import type { DatasetImportRecord } from '#/lib/import/types'
import { auditHistoryQueryKeys } from '#/lib/audit-history'
import type { AuditEventWire } from '#/lib/audit-history'
import { importQueryKeys } from '#/lib/import/data'
import type { ObjectDependency } from '#/lib/object-dependencies'
import { infinitePage, screenQueryClient, screenRoutes } from './screen-stories'
import type { ReadSeed, UnseededRead } from './screen-stories'

/**
 * The three data tabs of a dataset's detail page — Imports, Used by and History
 * (`src/components/v3/datasets/`). They are one file because they are one
 * screen's surfaces: each is a read of one canonical model, and each has the
 * same four states (loading, denied, failure, an honestly empty list), which
 * the stories below show per tab rather than once on the happy path.
 */
const DATASET_ID = '0198d970-e266-4000-8000-000000000d01'

const meta = {
  title: 'Datasets/Detail tabs',
  parameters: {
    tanstack: {
      router: {
        // The Imports tab links each receipt to its retained file.
        route: screenRoutes('/datasets/$datasetId', ['/import/$importId']),
        path: '/datasets/$datasetId',
        params: { datasetId: DATASET_ID },
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[880px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A story's read client, seeded with whatever that tab reads. */
function provider(data: ReadSeed[], read: UnseededRead = 'pending') {
  const client = screenQueryClient({ data, read })
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

// --- Imports ---------------------------------------------------------------

const committed: DatasetImportRecord = {
  id: 'imp-1',
  dataset_id: DATASET_ID,
  experiment_record_id: null,
  parser_id: 'p-1',
  parser_version_id: 'pv-1',
  file_id: 'f-1',
  connector_run_id: null,
  imported_row_ids: ['r1', 'r2'],
  parser_provenance: { name: 'Ambr parser', version: 3, key: 'ambr' },
  source_provenance: { filename: 'readings.csv' },
  outcome: { added: 2 },
  snapshot_version_id: 'v-1',
  status: 'committed',
  error_detail: null,
  created_at: '2026-09-25T10:11:00.000Z',
}

const failed: DatasetImportRecord = {
  ...committed,
  id: 'imp-2',
  file_id: 'file-9',
  parser_provenance: { name: 'Ambr parser', version: 2, key: 'ambr' },
  source_provenance: { filename: 'plate-3-run-2.csv' },
  outcome: {},
  imported_row_ids: [],
  status: 'failed',
  created_at: '2026-09-24T16:40:00.000Z',
}

const connector: DatasetImportRecord = {
  ...committed,
  id: 'imp-3',
  file_id: null,
  connector_run_id: 'run-7',
  parser_provenance: {},
  source_provenance: {},
  outcome: { added: 480 },
  status: 'committed',
  created_at: '2026-09-22T02:05:00.000Z',
}

const importSeeds: ReadSeed[] = [
  {
    key: importQueryKeys.imports(DATASET_ID),
    value: [committed, failed, connector],
  },
]

/** Committed, failed and connector-authored receipts, from the frozen provenance. */
export const Imports: Story = {
  decorators: [provider(importSeeds)],
  render: () => <DatasetImportsTab datasetId={DATASET_ID} />,
}

/** A dataset that has never been imported into: the create action is Import a file. */
export const ImportsEmpty: Story = {
  decorators: [
    provider([{ key: importQueryKeys.imports(DATASET_ID), value: [] }]),
  ],
  render: () => <DatasetImportsTab datasetId={DATASET_ID} />,
}

export const ImportsLoading: Story = {
  decorators: [provider([], 'pending')],
  render: () => <DatasetImportsTab datasetId={DATASET_ID} />,
}

/** A non-member read: the tab says who to ask rather than showing an empty list. */
export const ImportsDenied: Story = {
  decorators: [provider([], 'denied')],
  render: () => <DatasetImportsTab datasetId={DATASET_ID} />,
}

/** A failed read keeps its own state, with the retry the empty state offers. */
export const ImportsFailed: Story = {
  decorators: [provider([], 'error')],
  render: () => <DatasetImportsTab datasetId={DATASET_ID} />,
}

// --- Used by ---------------------------------------------------------------

const dependencies: ObjectDependency[] = [
  {
    kind: 'sheet_instance',
    id: '0198d970-e266-4000-8000-00000000s001',
    relation: 'resolved_dataset_binding',
    liveness: 'live',
    effect: 'read',
    label: 'Stability workbook',
  },
  {
    kind: 'record',
    id: '0198d970-e266-4000-8000-000000000r02',
    relation: 'resolved_dataset_binding',
    liveness: 'live',
    effect: 'read',
    label: 'Virus stability at 4 °C',
  },
  {
    // The dataset's own snapshot versions are not *users* of it, so the tab
    // must not list this row.
    kind: 'dataset_version',
    id: '0198d970-e266-4000-8000-0000000v0003',
    relation: 'snapshot_of_dataset',
    liveness: 'live',
    effect: 'read',
    label: 'Snapshot 7',
  },
]

const usedByKey = ['ui-port', 'dataset-usage', DATASET_ID] as const

export const UsedBy: Story = {
  decorators: [
    provider([
      {
        key: usedByKey,
        value: { kind: 'dataset', id: DATASET_ID, dependencies },
      },
    ]),
  ],
  render: () => <DatasetUsedByTab datasetId={DATASET_ID} />,
}

export const UsedByNothingYet: Story = {
  decorators: [
    provider([
      {
        key: usedByKey,
        value: { kind: 'dataset', id: DATASET_ID, dependencies: [] },
      },
    ]),
  ],
  render: () => <DatasetUsedByTab datasetId={DATASET_ID} />,
}

export const UsedByDenied: Story = {
  decorators: [provider([], 'denied')],
  render: () => <DatasetUsedByTab datasetId={DATASET_ID} />,
}

// --- History ---------------------------------------------------------------

function auditEvent(overrides: Partial<AuditEventWire> = {}): AuditEventWire {
  return {
    sequence: 1,
    id: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-09-22T02:05:00.000Z',
    entityType: 'dataset',
    entityUuid: DATASET_ID,
    operation: 'create',
    recordId: null,
    projectId: '10000000-0000-4000-8000-000000000009',
    actorUserId: 'actor-1',
    actorName: 'Ada Scientist',
    actorCredentialId: null,
    clientId: null,
    payload: { title: 'Ambr readings' },
    ...overrides,
  }
}

const historyPage = {
  formatVersion: 1 as const,
  events: [
    auditEvent(),
    auditEvent({
      sequence: 2,
      id: '00000000-0000-4000-8000-000000000002',
      createdAt: '2026-09-25T10:11:00.000Z',
      operation: 'import',
      actorName: null,
      actorCredentialId: 'cred-1',
      payload: { filename: 'readings.csv', added: 2 },
    }),
    auditEvent({
      sequence: 3,
      id: '00000000-0000-4000-8000-000000000003',
      createdAt: '2026-09-26T09:30:00.000Z',
      operation: 'update',
      payload: {
        changes: { description: { from: null, to: 'Ambr 1 L runs' } },
      },
    }),
  ],
  hasMore: false,
  nextCursor: null,
}

const historyKey = auditHistoryQueryKeys.events({ object: DATASET_ID })

export const History: Story = {
  decorators: [
    provider([{ key: historyKey, value: infinitePage(historyPage) }]),
  ],
  render: () => <DatasetHistoryTab datasetId={DATASET_ID} />,
}

export const HistoryEmpty: Story = {
  decorators: [
    provider([
      {
        key: historyKey,
        value: infinitePage({ ...historyPage, events: [] }),
      },
    ]),
  ],
  render: () => <DatasetHistoryTab datasetId={DATASET_ID} />,
}

export const HistoryLoading: Story = {
  decorators: [provider([], 'pending')],
  render: () => <DatasetHistoryTab datasetId={DATASET_ID} />,
}

export const HistoryFailed: Story = {
  decorators: [provider([], 'error')],
  render: () => <DatasetHistoryTab datasetId={DATASET_ID} />,
}

/** A non-member read: the timeline's error slot carries the denial message. */
export const HistoryDenied: Story = {
  decorators: [provider([], 'denied')],
  render: () => <DatasetHistoryTab datasetId={DATASET_ID} />,
}
