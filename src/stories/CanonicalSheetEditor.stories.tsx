import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { CanonicalSheetEditor } from '#/components/sheet/canonical-sheet-workspace'
import type { SheetInstance } from '#/lib/sheet-instance-data'

/**
 * The composed Sheet editor on its own, with a static instance: an ad-hoc
 * worksheet carrying local fields, so the grid renders real values without a
 * Dataset binding and therefore without any read.
 */
const FIELD_ID = '0198d970-e266-4000-8000-00000000f001'
const ROW_A = '0198d970-e266-4000-8000-0000000a0001'
const ROW_B = '0198d970-e266-4000-8000-0000000a0002'

const instance: SheetInstance = {
  id: '0198d970-e266-4000-8000-000000000030',
  workspaceId: '0198d970-e266-4000-8000-00000000ffff',
  projectId: null,
  notebookRecordId: null,
  sourceDefinitionVersionId: null,
  displayId: 'SH-0007',
  name: 'Bench calculations',
  description: null,
  lifecycle: 'active',
  revision: 4,
  state: {
    bindings: [],
    localFields: [
      {
        fieldId: FIELD_ID,
        key: 'observation',
        label: 'Observation',
        description: null,
        logicalType: 'text',
        nullable: true,
        defaultValue: null,
        cardinality: 'one',
        quantity: null,
        validation: {},
        category: null,
        relationship: null,
        computation: { mode: 'stored' },
        lifecycle: 'active',
      },
    ],
    localValues: {
      [ROW_A]: { [FIELD_ID]: 'Dilute 1:10 before reading' },
      [ROW_B]: { [FIELD_ID]: 'Re-read at 600 nm' },
    },
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: { [FIELD_ID]: 240 },
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'ad_hoc' },
  },
  duplicatedFromInstanceId: null,
  createdAt: '2026-08-16T12:00:00.000Z',
  updatedAt: '2026-08-16T12:30:00.000Z',
  createdByUserId: 'user-1',
  updatedByUserId: 'user-1',
}

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: () => new Promise(() => {}) },
    },
  })
}

function Harness({ readOnly }: { readOnly?: boolean }) {
  const [value] = useState(instance)
  return (
    <CanonicalSheetEditor
      instance={value}
      projectId={null}
      readOnly={readOnly}
    />
  )
}

const meta = {
  title: 'Sheet/Canonical sheet editor',
  component: CanonicalSheetEditor,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider client={client()}>
        <div className="h-[520px] w-[900px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { instance, projectId: null },
} satisfies Meta<typeof CanonicalSheetEditor>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <Harness /> }

/** Read-only: the reporting state a submitted revision renders in. */
export const ReadOnly: Story = { render: () => <Harness readOnly /> }

/** The editor without a project cannot write, whatever the instance says. */
export const NoProject: Story = {
  render: () => (
    <CanonicalSheetEditor
      instance={{ ...instance, projectId: null }}
      projectId={null}
    />
  ),
}

/** An archived instance is read-only by lifecycle, not by prop. */
export const Archived: Story = {
  render: () => (
    <CanonicalSheetEditor
      instance={{ ...instance, lifecycle: 'archived' }}
      projectId={null}
    />
  ),
}
