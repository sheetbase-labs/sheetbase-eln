import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AdHocSheetWorkspace } from '#/components/sheet/ad-hoc-sheet-workspace'
import type { SheetInstance } from '#/lib/sheet-instance-data'

/**
 * DSET-04 ad-hoc worksheet. It wraps `CanonicalSheetEditor` with the
 * instance's own project, so the editor's reachable static state is what the
 * stories show: local fields and values render from the instance's working
 * state with no Dataset binding, hence no reads.
 */
const FIELD_ID = '0198d970-e266-4000-8000-00000000f001'
const ROW_KEY = '0198d970-e266-4000-8000-00000000r001'.replace('r', 'a')

const instance: SheetInstance = {
  id: '0198d970-e266-4000-8000-000000000030',
  workspaceId: '0198d970-e266-4000-8000-00000000ffff',
  projectId: null,
  notebookRecordId: null,
  sourceDefinitionVersionId: null,
  displayId: 'SH-0007',
  name: 'Bench calculations',
  description: 'Working sheet, not yet linked to a Dataset.',
  lifecycle: 'active',
  revision: 3,
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
    localValues: { [ROW_KEY]: { [FIELD_ID]: 'Dilute 1:10 before reading' } },
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: { [FIELD_ID]: 220 },
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
  return <AdHocSheetWorkspace instance={value} readOnly={readOnly} />
}

const meta = {
  title: 'Sheet/Ad-hoc sheet workspace',
  component: AdHocSheetWorkspace,
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
  args: { instance },
} satisfies Meta<typeof AdHocSheetWorkspace>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { render: () => <Harness /> }

/** A read-only worksheet: selection and copy stay live, writing does not. */
export const ReadOnly: Story = { render: () => <Harness readOnly /> }
