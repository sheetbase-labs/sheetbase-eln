import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'

import { AddSheetColumnButton } from '#/components/templates/add-sheet-column'
import { parseNotebookTemplateConfiguration } from '#/lib/notebook-template'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import { parseSheetDefinitionConfiguration } from '#/lib/sheet-definition'
import type {
  SheetDefinition,
  SheetDefinitionVersion,
} from '#/lib/sheet-definition-data'
import { screenQueryClient, withApiReads } from './screen-stories'

/**
 * "Add column" under a sheet section of a draft template
 * (`src/components/templates/add-sheet-column.tsx`). A story never reaches the
 * server, so pressing Add column in the dialog shows its refusal.
 */
const COLUMN = '0198d970-e266-4000-8000-000000000a01'
const PLACEMENT = '0198d970-e266-4000-8000-000000000a02'
const SHEET_VERSION = '0198d970-e266-4000-8000-000000000a03'
const DEFINITION = '0198d970-e266-4000-8000-000000000a04'

const configuration = parseSheetDefinitionConfiguration({
  columns: [
    {
      id: COLUMN,
      field: {
        key: 'condition',
        label: 'Condition',
        fieldId: COLUMN,
        category: null,
        nullable: false,
        quantity: null,
        lifecycle: 'active',
        validation: {},
        cardinality: 'one',
        computation: { mode: 'stored' },
        description: null,
        logicalType: 'reference',
        defaultValue: null,
        relationship: {
          target: { kind: 'model', modelKey: 'material' },
          cardinality: 'one',
        },
      },
      source: { kind: 'declared' },
    },
  ],
  joins: [],
  actions: [],
  bindings: [],
  parameters: [],
  rowIdentity: { kind: 'local', columnIds: [COLUMN] },
  calculations: [],
  presentation: {
    sorts: [],
    density: 'standard',
    filters: [],
    columnOrder: [COLUMN],
    columnWidths: {},
    hiddenColumnIds: [],
    frozenColumnCount: 1,
  },
  formatVersion: 1,
  writeBackRules: [],
})

const sheet: SheetDefinitionVersion = {
  id: SHEET_VERSION,
  definitionId: DEFINITION,
  version: 1,
  lifecycle: 'published',
  configuration,
  revision: 1,
  publishedAt: '2026-09-25T08:40:00Z',
  retiredAt: null,
}

const definition: SheetDefinition = {
  id: DEFINITION,
  workspaceId: '0198d970-e266-4000-8000-0000000000a1',
  key: 'growth',
  name: 'Growth',
  description: null,
  lifecycle: 'active',
  revision: 1,
}

const draft: NotebookTemplateVersion = {
  id: '0198d970-e266-4000-8000-000000000a05',
  templateId: '0198d970-e266-4000-8000-000000000a06',
  version: 2,
  lifecycle: 'draft',
  configuration: parseNotebookTemplateConfiguration({
    formatVersion: 1,
    parameters: [],
    placements: [
      {
        id: PLACEMENT,
        kind: 'sheet',
        order: 1,
        definitionVersionId: SHEET_VERSION,
        parameterMappings: [],
      },
    ],
  }),
  revision: 1,
  publishedAt: null,
  publishedByUserId: null,
  reason: null,
  signedByUserId: null,
  signedMeaning: null,
  signedAt: null,
  retiredAt: null,
}

const client = screenQueryClient()

const meta = {
  title: 'Templates/Add sheet column',
  component: AddSheetColumnButton,
  decorators: [
    withApiReads('error'),
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: {
    templateVersion: draft,
    placementId: PLACEMENT,
    sectionName: 'Growth',
    sheet,
    definition,
  },
} satisfies Meta<typeof AddSheetColumnButton>

export default meta

type Story = StoryObj<typeof meta>

/** The button as it sits under the section's columns. */
export const Default: Story = {}

/** Open: a name, a type, and for a number a unit and the range it may take. */
export const DialogOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Add column/ }))
    await expect(await screen.findByRole('dialog')).toBeInTheDocument()
  },
}
