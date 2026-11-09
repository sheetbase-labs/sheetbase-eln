import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  FieldChangeList,
  FieldChangeRow,
} from '#/components/models/field-changes'
import {
  InheritedLabel,
  InheritedTableRows,
  inheritedRows,
} from '#/components/models/inherited-fields-table'
import type {
  InheritedGroup,
  InheritedRow,
} from '#/components/models/inherited-fields-table'
import { RecordModelEditDialog } from '#/components/models/record-model-edit-dialog'
import { RecordModelFields } from '#/components/models/record-model-fields-tab'
import { RecordModelEdit } from '#/components/models/record-model-edit'
import { modelTypeQueryKeys } from '#/components/models/model-subtype-data'
import { modelApprovalQueryKeys } from '#/components/models/model-approval-data'
import { recordModelQueryKeys } from '#/components/models/models-data'
import { workspaceMemberQueryKeys } from '#/components/projects/project-data'
import { Table, TableBody, TableBox, TableCell } from '#/components/ui/table'
import type { FieldChange } from '#/components/models/record-model-fields'
import { RECORD_MODEL_VERSION_KIND } from '#/lib/record-model-versions'
import type { RecordModelVersionDefinition } from '#/lib/record-model-versions'
import { screenQueryClient, screenRoutes } from './screen-stories'
import {
  CELL_BANK_ID,
  WORKSPACE_ID,
  cellBankModel,
  cellCultureFields,
  modelTypes,
} from './model-fixtures'

/**
 * How a model's fields are listed, edited and compared
 * (`src/components/models/`): the change rows of a draft, the inherited
 * fields a subtype shows above its own, the published Fields tab, the draft
 * editor and the in-place record edit dialog. Every read is seeded into the
 * query cache the screens use.
 */
type VField = RecordModelVersionDefinition['fields'][number]

function versionField(
  id: string,
  fieldName: string,
  label: string,
  overrides: Partial<VField> = {},
): VField {
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
  versionField('f1', 'cell_line', 'Cell line', {
    logical_type: 'category',
    nullable: false,
  }),
  versionField('f2', 'passage', 'Passage', {
    logical_type: 'integer',
    display_order: 1,
    validation: { min: 0, max: 80 },
  }),
]

const draftFields = [
  ...publishedFields,
  versionField('f3', 'viability', 'Viability', {
    logical_type: 'decimal',
    display_order: 2,
    validation: { min: 0, max: 100 },
  }),
]

const PUBLISHED_ID = '00000000-0000-4000-8000-0000000000b3'
const DRAFT_ID = '00000000-0000-4000-8000-0000000000b4'
const USER_ID = 'usr_01h3c9k2m4n5p6q7'

const versions = [
  {
    id: DRAFT_ID,
    model_id: CELL_BANK_ID,
    workspace_id: WORKSPACE_ID,
    version: 4,
    revision: 1,
    lifecycle: 'draft' as const,
    definition: { identifier_prefix: 'CB', fields: draftFields },
    reason: 'Add a viability range',
    created_at: '2026-09-24T08:00:00.000Z',
    created_by_user_id: USER_ID,
    published_at: null,
  },
  {
    id: PUBLISHED_ID,
    model_id: CELL_BANK_ID,
    workspace_id: WORKSPACE_ID,
    version: 3,
    revision: 2,
    lifecycle: 'published' as const,
    definition: { identifier_prefix: 'CB', fields: publishedFields },
    reason: 'Record the passage number at freeze',
    created_at: '2026-09-18T10:00:00.000Z',
    created_by_user_id: USER_ID,
    published_at: '2026-09-20T14:05:00.000Z',
  },
]

const usage = [
  {
    version_id: PUBLISHED_ID,
    record_count: 41,
    created_record_count: 12,
    upgraded_record_count: 29,
  },
]

const client = screenQueryClient({
  data: [
    {
      key: recordModelQueryKeys.model('cell_bank'),
      value: cellBankModel,
    },
    {
      key: ['ui-port', 'record-models', 'versions', CELL_BANK_ID],
      value: versions,
    },
    {
      key: ['ui-port', 'record-models', 'version-usage', CELL_BANK_ID],
      value: usage,
    },
    { key: modelTypeQueryKeys.all, value: modelTypes },
    {
      key: workspaceMemberQueryKeys.identities,
      value: [{ user_id: USER_ID, name: 'Grace Owner' }],
    },
    {
      key: modelApprovalQueryKeys.index([DRAFT_ID], RECORD_MODEL_VERSION_KIND),
      value: {
        requests: [],
        decisions: [],
        byVersion: new Map(),
        byRequest: new Map(),
      },
    },
  ],
})

const meta = {
  title: 'Models/Field tables',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/models', [
          '/models/$modelId',
          '/models/$modelId/records',
          '/models/$modelId/versions',
        ]),
        path: '/models',
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const noop = () => {}

// --- Change rows ------------------------------------------------------------

const changes: FieldChange[] = [
  {
    kind: 'Added',
    subject: 'Thaw viability',
    detail: 'Number, 1 dp · Release tests',
  },
  {
    kind: 'Changed',
    subject: 'Passage',
    detail: 'Rule',
    from: '≤ 40',
    to: '≤ 30',
  },
  { kind: 'Removed', subject: 'Legacy flag', detail: null },
]

/** The changes a draft makes to what is published: added, changed (old struck through), removed. */
export const ChangeList: Story = {
  render: () => (
    <div className="w-[560px] max-w-full p-6">
      <FieldChangeList changes={changes} label="Changes in this draft" />
    </div>
  ),
}

/** A single change row. */
export const ChangeRow: Story = {
  render: () => (
    <ul className="m-0 list-none p-6">
      <FieldChangeRow change={changes[1]} />
    </ul>
  ),
}

// --- Inherited fields -------------------------------------------------------

const groups: InheritedGroup[] = [
  {
    modelId: 'experiment',
    modelName: 'Experiment',
    rows: [
      {
        id: 'experiment:standard:Title',
        label: 'Title',
        key: null,
        type: 'Standard',
        unit: null,
        required: '—',
      },
      {
        id: 'experiment:temperature_c',
        label: 'Temperature',
        key: 'temperature_c',
        type: 'Number',
        unit: '°C',
        required: 'No',
      },
    ],
  },
  {
    modelId: 'cell_culture',
    modelName: 'Cell culture',
    rows: [
      {
        id: 'cell_culture:cell_line',
        label: 'Cell line',
        key: 'cell_line',
        type: 'Choice',
        unit: null,
        required: 'Yes',
      },
    ],
  },
]

const inheritedColumns: RegistryColumn<InheritedRow>[] = [
  {
    id: 'label',
    header: 'Field',
    cell: ({ row }) => <InheritedLabel row={row.original} />,
  },
  { id: 'type', header: 'Type', accessorFn: (row) => row.type },
  { id: 'unit', header: 'Unit', accessorFn: (row) => row.unit ?? '—' },
  { id: 'required', header: 'Required', accessorFn: (row) => row.required },
]

/** The inherited fields in a registry grid: a band per source model, each field locked. */
export const InheritedInGrid: Story = {
  render: () => (
    <div className="h-[340px] w-[760px] max-w-full">
      <RegistryGrid
        label="Inherited fields"
        rows={inheritedRows(groups)}
        columns={inheritedColumns}
        getRowId={(row) => row.id}
        selectable={false}
      />
    </div>
  ),
}

/** The same rows in an editor's plain table, with bands across every column. */
export const InheritedInPlainTable: Story = {
  render: () => (
    <div className="w-[640px] max-w-full p-6">
      <TableBox>
        <Table>
          <TableBody>
            <InheritedTableRows
              groups={groups}
              colSpan={2}
              cells={(row) => (
                <>
                  <TableCell>
                    <InheritedLabel row={row} />
                  </TableCell>
                  <TableCell>{row.type}</TableCell>
                </>
              )}
            />
          </TableBody>
        </Table>
      </TableBox>
    </div>
  ),
}

// --- Screens ----------------------------------------------------------------

/** The published Fields tab of a workspace model. */
export const FieldsTab: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <div className="flex h-[480px] w-[960px] max-w-full">
        <RecordModelFields modelKey="cell_bank" />
      </div>
    </QueryClientProvider>
  ),
}

/** The draft editor: changes against the published version, with the draft's fields. */
export const DraftEditor: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <div className="flex h-[640px] w-[1040px] max-w-full">
        <RecordModelEdit
          modelKey="cell_bank"
          role="admin"
          user={{ id: USER_ID, name: 'Grace Owner' }}
          workspaceId={WORKSPACE_ID}
        />
      </div>
    </QueryClientProvider>
  ),
}

/** A role without schema rights sees the draft read-only. */
export const DraftEditorReadOnly: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <div className="flex h-[640px] w-[1040px] max-w-full">
        <RecordModelEdit
          modelKey="cell_bank"
          role="viewer"
          user={{ id: USER_ID, name: 'Grace Owner' }}
          workspaceId={WORKSPACE_ID}
        />
      </div>
    </QueryClientProvider>
  ),
}

/** Editing a record's field values in place. */
export const EditValuesDialog: Story = {
  render: () => (
    <QueryClientProvider client={client}>
      <RecordModelEditDialog
        open
        onOpenChange={noop}
        recordId="rec-1"
        fields={cellCultureFields}
        stored={{ cell_line: 'CHO-K1', passage: 12 }}
      />
    </QueryClientProvider>
  ),
}
