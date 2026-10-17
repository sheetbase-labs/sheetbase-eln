import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordModelVersions } from '#/components/v3/models/record-model-versions'
import { RECORD_MODEL_VERSION_KIND } from '#/lib/record-model-versions'
import type {
  ModelChangeScope,
  RecordModelVersionDefinition,
} from '#/lib/record-model-versions'
import type { ObjectDependency } from '#/lib/object-dependencies'
import type { ApprovalRequest } from '#/lib/approval-requests'
import type { DataClient } from '#/lib/data-client'
import type { WorkspaceRecordModel } from '#/components/v3/models/models-data'
import type { ApprovalDecision } from '#/components/v3/models/model-approval'
import { screenQueryClient, stubDataClient } from './screen-stories'
import type { ClientRead, ReadSeed } from './screen-stories'

/**
 * The Versions screen of a workspace model
 * (`src/components/v3/models/record-model-versions.tsx`): what is published,
 * what is waiting for approval, and the draft's fields.
 *
 * The screen takes its own `client` — its prop, defaulted to the app's — so the
 * stories hand it a `stubDataClient` rather than seeding a query cache: the
 * screen reads the model, its versions, their record counts, the model's
 * dependents and the approval index by resource and RPC name, and each of those
 * can be answered, left pending or refused by name. It links nowhere, so it needs
 * no sandbox route tree.
 *
 * The approval panel and the draft field editor it mounts have their own files
 * (`ModelApprovalPanel.stories.tsx`, `RecordModelVersionEditor.stories.tsx`) for
 * the states they can be put in directly.
 */
const MODEL_KEY = 'cell_bank'
const MODEL_ID = '10000000-0000-4000-8000-000000000001'
const WORKSPACE_ID = '90000000-0000-4000-8000-000000000001'
const DRAFT_ID = '00000000-0000-4000-8000-0000000000b4'
const PUBLISHED_ID = '00000000-0000-4000-8000-0000000000b3'
const REQUEST_ID = '00000000-0000-4000-8000-0000000000c1'
const SUBMITTER_ID = 'usr_01h3c9k2m4n5p6q7'

const viewer = { id: 'usr_01h9x7w2q3e4r5t6', name: 'Grace Owner' }

const model: WorkspaceRecordModel = {
  id: MODEL_ID,
  workspace_id: WORKSPACE_ID,
  key: MODEL_KEY,
  name: 'Cell bank',
  description: 'Frozen cell bank lots and their release readings.',
  identifier_prefix: 'CB',
  lifecycle: 'active',
  current_version: 4,
  created_at: '2026-05-02T09:00:00.000Z',
  updated_at: '2026-09-25T08:30:00.000Z',
}

/** A field as a version definition carries it: the editor edits these in place. */
function versionField(
  id: string,
  fieldName: string,
  label: string,
  overrides: Partial<RecordModelVersionDefinition['fields'][number]> = {},
): RecordModelVersionDefinition['fields'][number] {
  return {
    id,
    field_name: fieldName,
    label,
    logical_type: 'text',
    nullable: true,
    display_order: 0,
    lifecycle: 'active',
    default_value: null,
    validation: {},
    cardinality: 'one',
    ...overrides,
  }
}

const publishedFields = [
  versionField(
    '00000000-0000-4000-8000-0000000000f1',
    'cell_line',
    'Cell line',
    { logical_type: 'category', nullable: false, display_order: 0 },
  ),
  versionField('00000000-0000-4000-8000-0000000000f2', 'passage', 'Passage', {
    logical_type: 'integer',
    nullable: false,
    display_order: 1,
    validation: { min: 0, max: 80 },
  }),
]

/** v4 adds `viability` and keeps the two fields v3 published. */
const draftFields = [
  ...publishedFields.map((field, index) => ({
    ...field,
    // Separate rows for the draft's copies: a version definition is its own
    // field set, and the editor keys an unsaved edit by these ids.
    id: `00000000-0000-4000-8000-0000000000${index === 0 ? 'e1' : 'e2'}`,
  })),
  versionField(
    '00000000-0000-4000-8000-0000000000f3',
    'viability',
    'Viability',
    {
      logical_type: 'decimal',
      display_order: 2,
      default_value: 90,
      validation: { min: 0, max: 100 },
      quantity: { kind: 'viability', dimension: 'fraction', storageUnit: '%' },
    },
  ),
]

/** Newest first, as the screen's read orders them. */
const versions = [
  {
    id: DRAFT_ID,
    model_id: MODEL_ID,
    workspace_id: WORKSPACE_ID,
    version: 4,
    revision: 1,
    lifecycle: 'draft' as const,
    definition: {
      identifier_prefix: 'CB',
      fields: draftFields,
      migrationScope: 'new-records-only' as ModelChangeScope,
    },
    reason: 'Add a viability range before the release testing round',
    created_at: '2026-09-24T08:00:00.000Z',
    created_by_user_id: SUBMITTER_ID,
    published_at: null,
  },
  {
    id: PUBLISHED_ID,
    model_id: MODEL_ID,
    workspace_id: WORKSPACE_ID,
    version: 3,
    revision: 2,
    lifecycle: 'published' as const,
    definition: { identifier_prefix: 'CB', fields: publishedFields },
    reason: 'Record the passage number at freeze',
    created_at: '2026-09-18T10:00:00.000Z',
    created_by_user_id: SUBMITTER_ID,
    published_at: '2026-09-20T14:05:00.000Z',
  },
]

/** Records pinned per version: 2 on the draft, 41 still on v3. */
const usage = [
  {
    version_id: DRAFT_ID,
    record_count: 2,
    created_record_count: 2,
    upgraded_record_count: 0,
  },
  {
    version_id: PUBLISHED_ID,
    record_count: 41,
    created_record_count: 12,
    upgraded_record_count: 29,
  },
]

const dependencies: ObjectDependency[] = [
  {
    kind: 'notebook_template_version',
    id: '80000000-0000-4000-8000-000000000001',
    relation: 'record_parameter',
    liveness: 'live',
    effect: 'read',
    label: 'Release testing template',
  },
  {
    kind: 'sheet_definition_version',
    id: '80000000-0000-4000-8000-000000000002',
    relation: 'bound_model',
    liveness: 'live',
    effect: 'read',
    label: 'Cell bank register',
  },
  {
    kind: 'sheet_instance',
    id: '80000000-0000-4000-8000-000000000003',
    relation: 'bound_record',
    liveness: 'live',
    effect: 'read',
    label: 'Lot 7 register',
  },
]

const pendingRequest: ApprovalRequest = {
  id: REQUEST_ID,
  workspace_id: WORKSPACE_ID,
  object_kind: RECORD_MODEL_VERSION_KIND,
  object_id: DRAFT_ID,
  object_revision: 1,
  required_approver_roles: ['owner', 'reviewer'],
  required_approvals: 2,
  require_independence: true,
  state: 'pending',
  reason: 'Viability becomes a release reading',
  decision_reason: null,
  approved_by_user_ids: [],
  submitted_by_user_id: SUBMITTER_ID,
  submitted_at: '2026-09-24T08:10:00.000Z',
  decided_by_user_id: null,
  decided_at: null,
  created_at: '2026-09-24T08:10:00.000Z',
  updated_at: '2026-09-24T08:10:00.000Z',
}

const noDecisions: ApprovalDecision[] = []

/** Every read the screen performs, answered from the fixtures above. */
const reads: Record<string, ClientRead> = {
  record_models: [model],
  record_model_versions: versions,
  record_model_version_usage: usage,
  discover_model_dependencies: { kind: 'model', id: MODEL_KEY, dependencies },
  approval_requests: [],
  approval_request_decisions: [],
}

/** The screen with one story's transport: its props are the same every time. */
function Screen({
  transport,
  role = 'owner',
}: {
  transport: DataClient
  role?: string | null
}) {
  return (
    <RecordModelVersions
      modelKey={MODEL_KEY}
      role={role}
      user={viewer}
      workspaceId={WORKSPACE_ID}
      client={transport}
    />
  )
}

/** The query cache the screen's reads land in, seeded for a story that needs it. */
function provider(seeds: ReadSeed[] = []) {
  const client = screenQueryClient({ data: seeds })
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <div className="h-[760px] w-[1180px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Models/Record model versions',
  decorators: [provider()],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/**
 * A published v3 and a draft v4: the draft is selected, so the inspector opens
 * its fields in the editor, with what a change would touch and what is still
 * pinned to v3. With no approval request yet, the draft cannot be published.
 */
export const Versions: Story = {
  render: () => <Screen transport={stubDataClient(reads)} />,
}

/**
 * v4 is waiting for approval, so it is locked: the editor is replaced by the
 * fields as they stand, the panel shows who it is waiting on, and publishing
 * stays disabled until the request is approved.
 */
export const VersionsPendingApproval: Story = {
  decorators: [
    // The panel resolves actor ids through `useUserNames`, whose read is a
    // server function: seed it so the story names the people it shows.
    provider([
      {
        key: ['user-names', [SUBMITTER_ID]],
        value: { [SUBMITTER_ID]: 'Ada Scientist' },
      },
    ]),
  ],
  render: () => (
    <Screen
      transport={stubDataClient({
        ...reads,
        approval_requests: [pendingRequest],
        approval_request_decisions: noDecisions,
      })}
    />
  ),
}

/**
 * A viewer reading a published model: the fields are listed rather than opened
 * for editing, and the panel offers no action, because naming approvers and
 * submitting a version needs `schema.edit` and deciding needs a writer role.
 */
export const VersionsReadOnly: Story = {
  render: () => (
    <Screen
      transport={stubDataClient({
        ...reads,
        record_model_versions: [versions[1]],
      })}
      role="viewer"
    />
  ),
}

/** A model that has never had a version: the screen asks for the first draft. */
export const VersionsEmpty: Story = {
  render: () => (
    <Screen
      transport={stubDataClient({
        ...reads,
        record_model_versions: [],
        record_model_version_usage: [],
      })}
    />
  ),
}

/** Nothing has been read yet: the screen says it is loading. */
export const VersionsLoading: Story = {
  render: () => (
    <Screen
      transport={stubDataClient({
        ...reads,
        record_models: 'pending',
        record_model_versions: 'pending',
        record_model_version_usage: 'pending',
        discover_model_dependencies: 'pending',
      })}
    />
  ),
}

/**
 * The model read fails. A refused read takes the same branch: the screen has one
 * unavailable state for both, with the Retry that re-runs the reads.
 */
export const VersionsUnavailable: Story = {
  render: () => (
    <Screen transport={stubDataClient({ ...reads, record_models: 'error' })} />
  ),
}

/** A model key that is not a model in this workspace. */
export const VersionsNotVisible: Story = {
  render: () => (
    <Screen transport={stubDataClient({ ...reads, record_models: [] })} />
  ),
}

/**
 * The versions read but the approval index refused: the screen keeps showing the
 * versions and says publication is disabled, because it cannot see whether the
 * draft is cleared to publish.
 */
export const VersionsApprovalsUnavailable: Story = {
  render: () => (
    <Screen
      transport={stubDataClient({ ...reads, approval_requests: 'denied' })}
    />
  ),
}

/**
 * The record counts per version refused: the rows say "Unavailable" and the
 * inspector says the upgrade evidence is unavailable, rather than reporting zero
 * records as if nothing used them.
 */
export const VersionsUsageUnavailable: Story = {
  render: () => (
    <Screen
      transport={stubDataClient({
        ...reads,
        record_model_version_usage: 'error',
      })}
    />
  ),
}
