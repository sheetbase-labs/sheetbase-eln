import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  CanonicalSheetWorkspace,
  ComposedSheetWorkspace,
} from '#/components/sheet/canonical-sheet-workspace'
import type { SheetInstance } from '#/lib/sheet-instance-data'

/**
 * The canonical Sheet workspace is route-level work: it reads the instance by
 * id and then its rows. The stories seed that instance read, so the loaded
 * workspace — writable, read-only and the composed record wrapper — renders
 * its real grid; the two failure stories leave the read pending or refused to
 * show the workspace's own loading and error paths.
 *
 * The instance below is an ad-hoc worksheet carrying local fields, the same
 * shape `CanonicalSheetEditor.stories.tsx` renders; no Dataset is bound, so
 * the grid needs no further read.
 */
const INSTANCE_ID = '0198d970-e266-4000-8000-000000000030'
const FIELD_ID = '0198d970-e266-4000-8000-00000000f001'
const ROW_A = '0198d970-e266-4000-8000-0000000a0001'
const ROW_B = '0198d970-e266-4000-8000-0000000a0002'

const instance: SheetInstance = {
  id: INSTANCE_ID,
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

function client(behaviour: 'loaded' | 'pending' | 'refused') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn:
          behaviour === 'loaded'
            ? async () => instance
            : behaviour === 'pending'
              ? () => new Promise<never>(() => {})
              : () => Promise.reject(new Error('offline')),
      },
    },
  })
  if (behaviour === 'loaded') {
    queryClient.setQueryData(['sheet-instance', INSTANCE_ID], instance)
  }
  return queryClient
}

function withClient(behaviour: 'loaded' | 'pending' | 'refused') {
  return (Story: () => ReactNode) => (
    <QueryClientProvider client={client(behaviour)}>
      <div className="h-[520px] w-[900px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Sheet/Canonical sheet workspace',
  component: CanonicalSheetWorkspace,
  tags: ['autodocs'],
  decorators: [withClient('loaded')],
  args: { instanceId: INSTANCE_ID, projectId: null },
} satisfies Meta<typeof CanonicalSheetWorkspace>
export default meta
type Story = StoryObj<typeof meta>

/** The loaded workspace with a writable-looking ad-hoc worksheet. */
export const Default: Story = {}

/** An instance read that cannot complete is reported, not shown as an empty
 * sheet. */
export const InstanceUnavailable: Story = {
  decorators: [withClient('pending')],
}

/** A refused instance read takes the same path. */
export const ReadRefused: Story = { decorators: [withClient('refused')] }

/** A read-only workspace (the reporting surface). */
export const ReadOnly: Story = { args: { readOnly: true } }

/** The composed wrapper renders the same workspace for a linked record. */
export const ComposedWrapper: Story = {
  render: (args) => (
    <ComposedSheetWorkspace
      instanceId={args.instanceId}
      projectId={args.projectId}
      readOnly={args.readOnly}
    />
  ),
}
