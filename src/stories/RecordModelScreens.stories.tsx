import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordModelNew } from '#/components/v3/models/record-model-new'
import { RecordModelRecord } from '#/components/v3/models/record-model-record'
import { RecordModelRecords } from '#/components/v3/models/record-model-records'
import {
  recordModelDetailQueryKeys,
  recordModelQueryKeys,
} from '#/components/v3/models/models-data'
import type {
  RecordModelProject,
  RecordModelRecord as ModelRecord,
  RecordModelUsedBy,
  WorkspaceRecordModel,
} from '#/components/v3/models/models-data'
import type { ModelFieldDefinition } from '#/lib/model-fields'
import type { ModelRule } from '#/lib/model-rules'
import type { TimelineEventWire } from '#/lib/sign-002'
import { holdRead, screenQueryClient, screenRoutes } from './screen-stories'
import type { ReadSeed, UnseededRead } from './screen-stories'

/**
 * The three screens of a workspace-defined model's records
 * (`src/components/v3/models/`): the list, the generated create form and the
 * record page. They are one file because they are one flow over one model — the
 * same fields, records and projects — and because the reads they share are the
 * states a reader wants to compare: the loaded screen, the honestly empty one,
 * the read that never settles, and the model or record that is not visible.
 *
 * `record-model-record.tsx` reads the record's timeline and who links to it;
 * `record-model-records.tsx` reads the model's fields as its columns. Nothing
 * here reaches the server: `holdRead` keeps a screen's own read in the cache in
 * the state the story names.
 */
const MODEL_KEY = 'cell_bank'
const MODEL_ID = '10000000-0000-4000-8000-000000000001'
const WORKSPACE_ID = '90000000-0000-4000-8000-000000000001'
const RECORD_ID = '20000000-0000-4000-8000-000000000003'
const PROJECT_ID = '30000000-0000-4000-8000-000000000001'
const SECOND_PROJECT_ID = '30000000-0000-4000-8000-000000000002'

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

/**
 * The model's active fields in display order — the list's columns, the form's
 * inputs and the record page's details. `viability` was added to the model on 1
 * September, after the oldest record below was created, which is the record
 * page's "added later" banner.
 */
const fields: ModelFieldDefinition[] = [
  {
    id: '40000000-0000-4000-8000-000000000001',
    modelKey: MODEL_KEY,
    fieldName: 'cell_line',
    label: 'Cell line',
    description: null,
    displayOrder: 0,
    logicalType: 'category',
    nullable: false,
    defaultValue: null,
    unit: null,
    quantity: null,
    validation: {},
    cardinality: 'one',
    categorySource: { kind: 'embedded' },
    relationship: null,
    lifecycle: 'active',
    options: [
      {
        id: '41000000-0000-4000-8000-000000000001',
        key: 'cho_k1',
        label: 'CHO-K1',
        displayOrder: 0,
        lifecycle: 'active',
      },
      {
        id: '41000000-0000-4000-8000-000000000002',
        key: 'hek293',
        label: 'HEK293',
        displayOrder: 1,
        lifecycle: 'active',
      },
    ],
    createdAt: '2026-05-02T09:00:00.000Z',
  },
  {
    id: '40000000-0000-4000-8000-000000000002',
    modelKey: MODEL_KEY,
    fieldName: 'passage',
    label: 'Passage',
    description: null,
    displayOrder: 1,
    logicalType: 'integer',
    nullable: false,
    defaultValue: null,
    unit: null,
    quantity: null,
    validation: { min: 0, max: 80 },
    cardinality: 'one',
    categorySource: null,
    relationship: null,
    lifecycle: 'active',
    options: [],
    createdAt: '2026-05-02T09:00:00.000Z',
  },
  {
    id: '40000000-0000-4000-8000-000000000003',
    modelKey: MODEL_KEY,
    fieldName: 'sterility',
    label: 'Sterility test passed',
    description: null,
    displayOrder: 2,
    logicalType: 'boolean',
    nullable: false,
    defaultValue: false,
    unit: null,
    quantity: null,
    validation: {},
    cardinality: 'one',
    categorySource: null,
    relationship: null,
    lifecycle: 'active',
    options: [],
    createdAt: '2026-05-02T09:00:00.000Z',
  },
  {
    id: '40000000-0000-4000-8000-000000000004',
    modelKey: MODEL_KEY,
    fieldName: 'viability',
    label: 'Viability',
    description: null,
    displayOrder: 3,
    logicalType: 'decimal',
    nullable: true,
    defaultValue: null,
    unit: null,
    quantity: { kind: 'viability', dimension: 'fraction', storageUnit: '%' },
    validation: { min: 0, max: 100 },
    cardinality: 'one',
    categorySource: null,
    relationship: null,
    lifecycle: 'active',
    options: [],
    createdAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: '40000000-0000-4000-8000-000000000005',
    modelKey: MODEL_KEY,
    fieldName: 'freeze_date',
    label: 'Frozen on',
    description: null,
    displayOrder: 4,
    logicalType: 'date',
    nullable: true,
    defaultValue: null,
    unit: null,
    quantity: null,
    validation: {},
    cardinality: 'one',
    categorySource: null,
    relationship: null,
    lifecycle: 'active',
    options: [],
    createdAt: '2026-05-02T09:00:00.000Z',
  },
]

const records: ModelRecord[] = [
  {
    id: RECORD_ID,
    identifier: 'CB-0013',
    title: 'CHO-K1 MCB lot 3',
    kind: MODEL_KEY,
    status: 'draft',
    // No viability: the model gained that field after this record was created.
    custom_fields: { cell_line: 'cho_k1', passage: 12, sterility: true },
    properties: null,
    tags: [],
    created_at: '2026-07-14T09:12:00.000Z',
    updated_at: '2026-08-04T15:02:00.000Z',
    archived_at: null,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    identifier: 'CB-0012',
    title: 'HEK293 WCB lot 7',
    kind: MODEL_KEY,
    status: 'approved',
    custom_fields: {
      cell_line: 'hek293',
      passage: 4,
      sterility: true,
      viability: 92,
      freeze_date: '2026-09-21',
    },
    properties: null,
    tags: [],
    created_at: '2026-09-21T10:40:00.000Z',
    updated_at: '2026-09-25T08:30:00.000Z',
    archived_at: null,
  },
  {
    id: '20000000-0000-4000-8000-000000000001',
    identifier: 'CB-0011',
    title: 'CHO-K1 WCB lot 1',
    kind: MODEL_KEY,
    status: 'quarantined',
    custom_fields: {
      cell_line: 'cho_k1',
      passage: 31,
      sterility: false,
      viability: null,
    },
    properties: null,
    tags: [],
    created_at: '2026-05-06T13:20:00.000Z',
    updated_at: '2026-05-30T09:00:00.000Z',
    archived_at: null,
  },
]

const projects: RecordModelProject[] = [
  { id: PROJECT_ID, key: 'stable_cell_lines', title: 'Stable cell lines' },
]

const secondProject: RecordModelProject = {
  id: SECOND_PROJECT_ID,
  key: 'process_development',
  title: 'Process development',
}

const usedBy: RecordModelUsedBy[] = [
  {
    linkType: 'material_of',
    createdAt: '2026-09-27T11:05:00.000Z',
    source: {
      id: '60000000-0000-4000-8000-000000000001',
      identifier: 'MAT-0008',
      title: 'Working cell bank CB-0012',
      kind: 'material',
    },
  },
  {
    linkType: 'input_of',
    createdAt: '2026-09-26T09:30:00.000Z',
    source: {
      id: '60000000-0000-4000-8000-000000000002',
      identifier: 'EXP-0042',
      title: 'Release testing — lot 3',
      kind: 'experiment',
    },
  },
  {
    // A link whose source record is not readable in this workspace: the page
    // says so rather than printing an empty name.
    linkType: 'referenced_by',
    createdAt: '2026-09-28T14:20:00.000Z',
    source: null,
  },
]

const timeline: TimelineEventWire[] = [
  {
    type: 'change_event',
    id: 'ev-41',
    seq: 41,
    ts: '2026-07-14T09:12:00.000Z',
    title: 'create',
    actorUserId: '50000000-0000-4000-8000-000000000001',
    operation: 'create',
    payload: { title: 'CHO-K1 MCB lot 3' },
  },
  {
    type: 'change_event',
    id: 'ev-48',
    seq: 48,
    ts: '2026-07-22T16:04:00.000Z',
    title: 'update',
    actorUserId: '50000000-0000-4000-8000-000000000002',
    operation: 'update',
    payload: { custom_fields: { passage: 12 } },
  },
  {
    type: 'revision',
    id: 'rev-9',
    seq: null,
    ts: '2026-08-02T10:00:00.000Z',
    title: 'revision created',
    actorUserId: '50000000-0000-4000-8000-000000000002',
    reason: 'Corrected the passage number after the second count',
  },
  {
    type: 'check',
    id: 'chk-3',
    seq: null,
    ts: '2026-08-03T08:40:00.000Z',
    title: 'sterility check',
    actorUserId: '50000000-0000-4000-8000-000000000003',
    overallStatus: 'passed',
  },
  {
    type: 'comment',
    id: 'cmt-2',
    seq: null,
    ts: '2026-08-04T15:02:00.000Z',
    title: 'comment',
    actorUserId: '50000000-0000-4000-8000-000000000001',
    state: 'resolved',
    reason: 'Second count agrees; carried forward.',
  },
]

/**
 * Two rules on the model: one that blocks a record without a release reading,
 * and one that merely flags a high passage. The create form evaluates them
 * against its own (still empty) values, so the block is on screen before
 * anything is typed.
 */
const rules: ModelRule[] = [
  {
    id: '70000000-0000-4000-8000-000000000001',
    workspaceId: WORKSPACE_ID,
    modelKey: MODEL_KEY,
    name: 'A release reading is required',
    fieldKeys: ['viability'],
    condition: { field: 'viability', op: 'is_null' },
    effect: 'block',
    message:
      'Record a viability reading before this cell bank can be released.',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
  {
    id: '70000000-0000-4000-8000-000000000002',
    workspaceId: WORKSPACE_ID,
    modelKey: MODEL_KEY,
    name: 'High passage is flagged',
    fieldKeys: ['passage'],
    condition: { field: 'passage', op: 'gte', value: 30 },
    effect: 'warn',
    message: 'Passage numbers of 30 or more are flagged for review.',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  },
]

// --- The reads each screen performs -----------------------------------------

/** What the records list reads: the model, its fields (the columns) and rows. */
const listReads = [
  recordModelQueryKeys.model(MODEL_KEY),
  recordModelQueryKeys.fields(MODEL_KEY),
  recordModelQueryKeys.records(MODEL_KEY),
]

/** The create form reads the model, its fields, its rules and the projects. */
const newRecordReads = [
  ...listReads,
  recordModelDetailQueryKeys.rules(MODEL_KEY),
  recordModelDetailQueryKeys.projects,
]

/** The record page reads the record, its inbound links and its timeline. */
const recordReads = [
  recordModelQueryKeys.model(MODEL_KEY),
  recordModelQueryKeys.fields(MODEL_KEY),
  recordModelDetailQueryKeys.record(RECORD_ID),
  recordModelDetailQueryKeys.usedBy(RECORD_ID),
  recordModelDetailQueryKeys.timeline(RECORD_ID),
]

/** Success reads, plus held reads: one group per mode a story holds. */
function provider(
  seeds: ReadSeed[] = [],
  held: { keys: readonly (readonly unknown[])[]; read: UnseededRead }[] = [],
) {
  const client = screenQueryClient({ data: seeds })
  for (const group of held) {
    for (const key of group.keys) holdRead(client, key, group.read)
  }
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

const modelSeeds: ReadSeed[] = [
  { key: recordModelQueryKeys.model(MODEL_KEY), value: model },
]
const fieldSeeds: ReadSeed[] = [
  { key: recordModelQueryKeys.fields(MODEL_KEY), value: fields },
]

function rulesSeed(modelRules: ModelRule[]): ReadSeed[] {
  return [
    { key: recordModelDetailQueryKeys.rules(MODEL_KEY), value: modelRules },
  ]
}

function projectSeeds(modelProjects: RecordModelProject[]): ReadSeed[] {
  return [{ key: recordModelDetailQueryKeys.projects, value: modelProjects }]
}

/**
 * What a model this caller cannot see answers: RLS filters the row out, so the
 * model reads as absent and its fields and records read as empty rather than
 * being left to run.
 */
const invisibleModelSeeds: ReadSeed[] = [
  { key: recordModelQueryKeys.fields(MODEL_KEY), value: [] },
  { key: recordModelQueryKeys.records(MODEL_KEY), value: [] },
]

const listSeeds: ReadSeed[] = [
  ...modelSeeds,
  ...fieldSeeds,
  { key: recordModelQueryKeys.records(MODEL_KEY), value: records },
]

const recordSeeds: ReadSeed[] = [
  ...modelSeeds,
  ...fieldSeeds,
  { key: recordModelDetailQueryKeys.record(RECORD_ID), value: records[0] },
  { key: recordModelDetailQueryKeys.usedBy(RECORD_ID), value: usedBy },
  { key: recordModelDetailQueryKeys.timeline(RECORD_ID), value: timeline },
]

// --- Routes -----------------------------------------------------------------

/**
 * Every path these three screens link to, plus the path the stories render on.
 * The story's own route comes first: `screenRoutes` takes the path the story
 * renders on and then the paths it links to, and the framework injects the
 * story into the tree's first route.
 */
const ROUTES = screenRoutes('/models/$modelId/records', [
  '/models/$modelId/records/new',
  '/models/$modelId/records/$recordId',
  '/models',
  '/projects',
])

const meta = {
  title: 'Models/Record screens',
  parameters: {
    tanstack: {
      router: {
        route: ROUTES,
        // The story's own path. The tree above carries every path these
        // screens link to, so each story's links resolve wherever it renders.
        path: '/models/$modelId/records',
        params: { modelId: MODEL_KEY },
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="h-[720px] w-[1040px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

// --- Records list -----------------------------------------------------------

/** Columns are the model's fields; values come from the records themselves. */
export const Records: Story = {
  decorators: [provider(listSeeds)],
  render: () => <RecordModelRecords modelKey={MODEL_KEY} />,
}

/** A model that has been defined but has no records yet. */
export const RecordsEmpty: Story = {
  decorators: [
    provider([
      ...modelSeeds,
      ...fieldSeeds,
      { key: recordModelQueryKeys.records(MODEL_KEY), value: [] },
    ]),
  ],
  render: () => <RecordModelRecords modelKey={MODEL_KEY} />,
}

/** The rows read never settles: the table says it is loading. */
export const RecordsLoading: Story = {
  decorators: [provider([], [{ keys: listReads, read: 'pending' }])],
  render: () => <RecordModelRecords modelKey={MODEL_KEY} />,
}

/**
 * A model the caller cannot see — another workspace's model, or one RLS hides.
 * The read returns no row, and a refused read takes the same branch: this screen
 * has one not-found state, not a separate error one.
 */
export const RecordsModelNotVisible: Story = {
  decorators: [
    provider([
      { key: recordModelQueryKeys.model(MODEL_KEY), value: null },
      // RLS hides the model's fields and records with it, so those reads answer
      // with empty lists rather than running.
      ...invisibleModelSeeds,
    ]),
  ],
  render: () => <RecordModelRecords modelKey={MODEL_KEY} />,
}

/**
 * The model is visible but its records read is refused. The screen reads the
 * refusal as an empty list (`data ?? []`), so it says "No records yet" rather
 * than reporting the refusal.
 */
export const RecordsReadRefused: Story = {
  decorators: [
    provider(
      [...modelSeeds, ...fieldSeeds],
      [{ keys: [recordModelQueryKeys.records(MODEL_KEY)], read: 'denied' }],
    ),
  ],
  render: () => <RecordModelRecords modelKey={MODEL_KEY} />,
}

// --- Create form ------------------------------------------------------------

/**
 * The form is generated from the model's fields. It opens pristine: required
 * values are empty, so Create is disabled and the ID it will ask for is shown
 * from the highest identifier already visible.
 */
export const NewRecord: Story = {
  decorators: [
    provider([...listSeeds, ...projectSeeds(projects), ...rulesSeed([])]),
  ],
  render: () => <RecordModelNew modelKey={MODEL_KEY} />,
}

/** More than one project: the form asks which one the record belongs to. */
export const NewRecordProjectPicker: Story = {
  decorators: [
    provider([
      ...listSeeds,
      ...projectSeeds([...projects, secondProject]),
      ...rulesSeed([]),
    ]),
  ],
  render: () => <RecordModelNew modelKey={MODEL_KEY} />,
}

/**
 * A workspace with no project yet. Every record is filed under one, so the form
 * says that and offers the way to fix it instead of disabling Create silently.
 */
export const NewRecordNoProject: Story = {
  decorators: [provider([...listSeeds, ...projectSeeds([]), ...rulesSeed([])])],
  render: () => <RecordModelNew modelKey={MODEL_KEY} />,
}

/** A model whose fields are all retired: there is nothing to fill in yet. */
export const NewRecordNoFields: Story = {
  decorators: [
    provider([
      ...modelSeeds,
      { key: recordModelQueryKeys.fields(MODEL_KEY), value: [] },
      { key: recordModelQueryKeys.records(MODEL_KEY), value: records },
      ...projectSeeds(projects),
      ...rulesSeed([]),
    ]),
  ],
  render: () => <RecordModelNew modelKey={MODEL_KEY} />,
}

/** Nothing has been read yet: the form waits rather than rendering empty. */
export const NewRecordLoading: Story = {
  decorators: [provider([], [{ keys: newRecordReads, read: 'pending' }])],
  render: () => <RecordModelNew modelKey={MODEL_KEY} />,
}

/** A model this caller cannot see cannot be created into either. */
export const NewRecordModelNotVisible: Story = {
  decorators: [
    provider([
      { key: recordModelQueryKeys.model(MODEL_KEY), value: null },
      ...invisibleModelSeeds,
      ...projectSeeds(projects),
      ...rulesSeed([]),
    ]),
  ],
  render: () => <RecordModelNew modelKey={MODEL_KEY} />,
}

/**
 * The model's own rules, evaluated against the form's current values: the block
 * is shown before anything is saved, and Create stays disabled while it applies.
 */
export const NewRecordBlockedByRules: Story = {
  decorators: [
    provider([...listSeeds, ...projectSeeds(projects), ...rulesSeed(rules)]),
  ],
  render: () => <RecordModelNew modelKey={MODEL_KEY} />,
}

// --- Record page ------------------------------------------------------------

/** The model's fields as a details list, who links to the record, its history. */
export const Record: Story = {
  decorators: [provider(recordSeeds)],
  render: () => <RecordModelRecord modelKey={MODEL_KEY} recordId={RECORD_ID} />,
}

/** Read but untouched: no inbound links, no history, and the page says so. */
export const RecordNoHistory: Story = {
  decorators: [
    provider([
      ...modelSeeds,
      ...fieldSeeds,
      { key: recordModelDetailQueryKeys.record(RECORD_ID), value: records[1] },
      { key: recordModelDetailQueryKeys.usedBy(RECORD_ID), value: [] },
      { key: recordModelDetailQueryKeys.timeline(RECORD_ID), value: [] },
    ]),
  ],
  render: () => <RecordModelRecord modelKey={MODEL_KEY} recordId={RECORD_ID} />,
}

/**
 * Nothing has been read yet. The details and the history say they are loading;
 * the Used by list, which does not read the loading flag, shows its own empty
 * message.
 */
export const RecordLoading: Story = {
  decorators: [provider([], [{ keys: recordReads, read: 'pending' }])],
  render: () => <RecordModelRecord modelKey={MODEL_KEY} recordId={RECORD_ID} />,
}

/** A record that is not visible in this workspace, or has been removed. */
export const RecordNotFound: Story = {
  decorators: [
    provider([
      ...modelSeeds,
      ...fieldSeeds,
      { key: recordModelDetailQueryKeys.record(RECORD_ID), value: null },
      // A record this caller cannot read has no links and no history to read
      // either.
      { key: recordModelDetailQueryKeys.usedBy(RECORD_ID), value: [] },
      { key: recordModelDetailQueryKeys.timeline(RECORD_ID), value: [] },
    ]),
  ],
  render: () => <RecordModelRecord modelKey={MODEL_KEY} recordId={RECORD_ID} />,
}

/**
 * The record loaded but its history refused: the details and the used-by list
 * stand, and the history section reports its own failure.
 */
export const RecordHistoryFailed: Story = {
  decorators: [
    provider(
      [
        ...modelSeeds,
        ...fieldSeeds,
        {
          key: recordModelDetailQueryKeys.record(RECORD_ID),
          value: records[0],
        },
        { key: recordModelDetailQueryKeys.usedBy(RECORD_ID), value: usedBy },
      ],
      [
        {
          keys: [recordModelDetailQueryKeys.timeline(RECORD_ID)],
          read: 'error',
        },
      ],
    ),
  ],
  render: () => <RecordModelRecord modelKey={MODEL_KEY} recordId={RECORD_ID} />,
}
