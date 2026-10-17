import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RecordModelVersionEditor } from '#/components/v3/models/record-model-version-editor'
import type { ModelFieldImpact } from '#/components/v3/models/model-field-impact'
import type { RecordModelVersion } from '#/lib/record-model-versions'

/**
 * The draft field editor of a model version
 * (`src/components/v3/models/record-model-version-editor.tsx`), as the Versions
 * screen mounts it in its inspector. Its props are the draft, what the change
 * would touch, which field keys are already published and whether a save is in
 * flight, so the stories set those directly: a draft that keeps two published
 * fields and adds one, a draft with no fields at all, and a save in progress.
 *
 * The editor needs no query context and no client: saving is the host's
 * (`onSave`), and nothing here writes.
 */
const MODEL_ID = '10000000-0000-4000-8000-000000000001'
const WORKSPACE_ID = '90000000-0000-4000-8000-000000000001'
const PUBLISHED_ID = '00000000-0000-4000-8000-0000000000b3'

/**
 * A draft v4: `cell_line` and `passage` were published in v3, so their keys are
 * locked; `viability` is new to this draft, so its key can still change.
 */
const draft: RecordModelVersion = {
  id: '00000000-0000-4000-8000-0000000000b4',
  model_id: MODEL_ID,
  workspace_id: WORKSPACE_ID,
  version: 4,
  revision: 1,
  lifecycle: 'draft',
  definition: {
    identifier_prefix: 'CB',
    fields: [
      {
        id: '00000000-0000-4000-8000-0000000000e1',
        field_name: 'cell_line',
        label: 'Cell line',
        logical_type: 'category',
        nullable: false,
        display_order: 0,
        lifecycle: 'active',
        default_value: null,
        validation: {},
        cardinality: 'one',
      },
      {
        id: '00000000-0000-4000-8000-0000000000e2',
        field_name: 'passage',
        label: 'Passage',
        logical_type: 'integer',
        nullable: false,
        display_order: 1,
        lifecycle: 'active',
        default_value: null,
        validation: { min: 0, max: 80 },
        cardinality: 'one',
      },
      {
        id: '00000000-0000-4000-8000-0000000000f3',
        field_name: 'viability',
        label: 'Viability',
        logical_type: 'decimal',
        nullable: true,
        display_order: 2,
        lifecycle: 'active',
        default_value: 90,
        validation: { min: 0, max: 100 },
        cardinality: 'one',
        quantity: {
          kind: 'viability',
          dimension: 'fraction',
          storageUnit: '%',
        },
      },
    ],
  },
  reason: 'Add a viability range before the release testing round',
  created_at: '2026-09-24T08:00:00.000Z',
  created_by_user_id: 'usr_01h3c9k2m4n5p6q7',
  published_at: null,
}

/** A fresh draft v1, before anything has been added to it. */
const emptyDraft: RecordModelVersion = {
  ...draft,
  id: '00000000-0000-4000-8000-0000000000b1',
  version: 1,
  definition: { identifier_prefix: 'CB', fields: [] },
  reason: 'Define the model',
}

const impact: ModelFieldImpact = {
  recordsOnEachVersion: [
    { versionId: draft.id, version: 4, recordCount: 2 },
    { versionId: PUBLISHED_ID, version: 3, recordCount: 41 },
  ],
  // Everything pinned behind the head version is what "also migrate" would move.
  migratableRecords: 41,
  templates: 1,
  sheets: 2,
}

const emptyImpact: ModelFieldImpact = {
  recordsOnEachVersion: [
    { versionId: emptyDraft.id, version: 1, recordCount: 0 },
  ],
  migratableRecords: 0,
  templates: 0,
  sheets: 0,
}

const meta = {
  title: 'Models/Version editor',
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/**
 * The draft as the inspector opens it: the published keys are locked with the
 * reason, the new field's key is free, and Save waits for a reason for change.
 */
export const Draft: Story = {
  render: () => (
    <RecordModelVersionEditor
      version={draft}
      impact={impact}
      publishedFieldNames={['cell_line', 'passage']}
      publishedVersion={3}
      busy={false}
      onSave={() => {}}
    />
  ),
}

/** A draft with nothing in it yet: add the first field, and no impact to weigh. */
export const DraftNoFields: Story = {
  render: () => (
    <RecordModelVersionEditor
      version={emptyDraft}
      impact={emptyImpact}
      publishedFieldNames={[]}
      publishedVersion={null}
      busy={false}
      onSave={() => {}}
    />
  ),
}

/** A save in flight: every input is held disabled until the server answers. */
export const Saving: Story = {
  render: () => (
    <RecordModelVersionEditor
      version={draft}
      impact={impact}
      publishedFieldNames={['cell_line', 'passage']}
      publishedVersion={3}
      busy
      onSave={() => {}}
    />
  ),
}
