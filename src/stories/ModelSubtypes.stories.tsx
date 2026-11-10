import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  TableBasedOnDialog,
  TableSubtypeOf,
  TableSubtypesList,
  NewTableSubtypeDialog,
} from '#/components/models/dataset-subtype-ui'
import { measurementTableKeys } from '#/components/models/dataset-subtype-data'
import type { MeasurementTable } from '#/components/models/dataset-subtype-data'
import { modelTypeQueryKeys } from '#/components/models/model-subtype-data'
import {
  BasedOnDialog,
  NewSubtypeDialog,
  SubtypeObjects,
  SubtypeOf,
  SubtypesList,
} from '#/components/models/model-subtype-ui'
import { recordModelQueryKeys } from '#/components/models/models-data'
import { screenQueryClient, screenRoutes } from './screen-stories'
import { WORKSPACE_ID, cellCultureFields, modelTypes } from './model-fixtures'

/**
 * Subtypes of a model and of a measurement table
 * (`src/components/models/model-subtype-ui.tsx`,
 * `dataset-subtype-ui.tsx`): the "Subtype of" line, the subtypes list in a
 * model header, the typed records tab and the dialogs that make or move a
 * subtype. The model-type list and each type's fields are seeded, so the
 * dialogs never fetch.
 */
const tables: MeasurementTable[] = [
  { id: 'tbl-1', name: 'Cell counts', parentId: null },
  { id: 'tbl-2', name: 'Viability counts', parentId: 'tbl-1' },
  { id: 'tbl-3', name: 'Plate reads', parentId: null },
]

const client = screenQueryClient({
  data: [
    { key: modelTypeQueryKeys.all, value: modelTypes },
    {
      key: [...modelTypeQueryKeys.all, 'objects', 'cell_culture'],
      value: [
        {
          id: 'e-1',
          identifier: 'CC-0007',
          name: 'CHO-K1 expansion',
          href: '/experiments',
          customFields: { cell_line: 'CHO-K1', passage: 12 },
        },
        {
          id: 'e-2',
          identifier: 'CC-0008',
          name: 'HEK293 thaw',
          href: '/experiments',
          customFields: { cell_line: 'HEK293', passage: 3 },
        },
      ],
    },
    {
      key: [...recordModelQueryKeys.fields('cell_culture'), 'current'],
      value: cellCultureFields,
    },
    { key: measurementTableKeys.all, value: tables },
    { key: measurementTableKeys.inherited('tbl-2'), value: [] },
  ],
})

const emptyClient = screenQueryClient({
  data: [
    { key: modelTypeQueryKeys.all, value: modelTypes },
    {
      key: [...modelTypeQueryKeys.all, 'objects', 'perfusion_run'],
      value: [],
    },
    {
      key: [...recordModelQueryKeys.fields('perfusion_run'), 'current'],
      value: [],
    },
  ],
})

const meta = {
  title: 'Models/Subtypes',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/models', [
          '/models/$modelId',
          '/models/$modelId/records/new',
          '/experiments',
        ]),
        path: '/models',
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const noop = () => {}

/** A subtype names its parent as a link. */
export const SubtypeOfParent: Story = {
  render: () => (
    <div className="text-label text-fg-muted">
      <SubtypeOf modelKey="cell_culture" />
    </div>
  ),
}

/** A model with direct subtypes lists them for its header. */
export const SubtypesInHeader: Story = {
  render: () => (
    <div className="text-label text-fg-muted">
      <SubtypesList modelKey="experiment" />
    </div>
  ),
}

/** A subtype's Records tab: its objects, with its own fields as columns. */
export const TypedRecords: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="flex h-[360px] w-[820px] max-w-full">
      <SubtypeObjects modelKey="cell_culture" />
    </div>
  ),
}

/** A subtype nothing has been made from yet. */
export const TypedRecordsEmpty: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <QueryClientProvider client={emptyClient}>
      <div className="flex h-[300px] w-[820px] max-w-full">
        <SubtypeObjects modelKey="perfusion_run" />
      </div>
    </QueryClientProvider>
  ),
}

/** Making a subtype: name, prefix and description, validated before it is sent. */
export const NewSubtype: Story = {
  render: () => (
    <NewSubtypeDialog
      open
      onOpenChange={noop}
      workspaceId={WORKSPACE_ID}
      parentKey="experiment"
      parentName="Experiment"
    />
  ),
}

/** Moving a type under another model, or out on its own. */
export const BasedOn: Story = {
  render: () => (
    <BasedOnDialog
      open
      onOpenChange={noop}
      model={{ id: 'mt-2', key: 'perfusion_run', name: 'Perfusion run' }}
    />
  ),
}

/** A measurement table that is a subtype names its parent table. */
export const TableSubtypeOfParent: Story = {
  render: () => (
    <div className="text-label text-fg-muted">
      <TableSubtypeOf id="tbl-2" />
    </div>
  ),
}

/** A measurement table lists its subtypes. */
export const TableSubtypes: Story = {
  render: () => (
    <div className="text-label text-fg-muted">
      <TableSubtypesList id="tbl-1" />
    </div>
  ),
}

/** Making a measurement-table subtype. */
export const NewTableSubtype: Story = {
  render: () => (
    <NewTableSubtypeDialog
      open
      onOpenChange={noop}
      parent={{ id: 'tbl-1', name: 'Cell counts' }}
    />
  ),
}

/** Moving a measurement table under another. */
export const TableBasedOn: Story = {
  render: () => (
    <TableBasedOnDialog
      open
      onOpenChange={noop}
      table={{ id: 'tbl-2', name: 'Viability counts' }}
    />
  ),
}
