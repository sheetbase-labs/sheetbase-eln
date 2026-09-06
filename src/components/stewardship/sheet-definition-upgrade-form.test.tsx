import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import type { Parameter } from '#/lib/parameter'
import type { SheetDefinitionUpgradePreview } from '#/lib/sheet-definition-upgrade'

import { SheetDefinitionUpgradeForm } from './sheet-definition-upgrade-form'

const SCHEMA_VERSION_ID = '10000000-0000-4000-8000-000000000004'
const DATASET_ID = '10000000-0000-4000-8000-000000000002'
const INCOMPATIBLE_DATASET_ID = '10000000-0000-4000-8000-000000000005'
const PARAM_ID = '20000000-0000-4000-8000-000000000002'
const DEFINITION_ID = '30000000-0000-4000-8000-000000000001'
const SOURCE_VERSION_ID = '30000000-0000-4000-8000-000000000002'
const TARGET_VERSION_ID = '30000000-0000-4000-8000-000000000003'
const INSTANCE_ID = '30000000-0000-4000-8000-000000000004'

const targetParameters: Parameter[] = [
  {
    id: PARAM_ID,
    key: 'results',
    label: 'Results',
    required: true,
    type: {
      kind: 'dataset',
      contract: { mode: 'exact', schemaVersionId: SCHEMA_VERSION_ID },
    },
    constraints: {},
  },
]

const preview: SheetDefinitionUpgradePreview = {
  source: {
    definitionId: DEFINITION_ID,
    versionId: SOURCE_VERSION_ID,
    version: 1,
    instanceId: INSTANCE_ID,
    instanceRevision: 1,
  },
  target: {
    definitionId: DEFINITION_ID,
    versionId: TARGET_VERSION_ID,
    version: 2,
  },
  automaticChanges: [],
  conflicts: [
    {
      id: `parameter-required:${PARAM_ID}`,
      kind: 'parameter-required',
      sourceId: PARAM_ID,
      targetCandidates: [],
      allowedOutcomes: ['defer'],
      instanceReferences: {
        localField: false,
        localValueCount: 0,
        calculationIds: [],
        calculationOverride: false,
        presentation: false,
      },
    },
  ],
  preserved: {
    localFieldIds: [],
    localValueRowCount: 0,
    instanceCalculationIds: [],
    calculationOverrideIds: [],
    presentationOwnedByInstance: true,
    bindingProvenanceRevalidated: true,
    writeOwnershipFromTarget: true,
  },
}

function client(): DataClient {
  return {
    list: vi.fn(async (resource: string) => {
      if (resource === 'datasets') {
        return [
          {
            id: DATASET_ID,
            workspace_id: 'workspace-1',
            schema_version_id: SCHEMA_VERSION_ID,
            name: 'Purification results',
            description: null,
            lifecycle: 'active',
            revision: 1,
          },
          {
            id: INCOMPATIBLE_DATASET_ID,
            workspace_id: 'workspace-1',
            schema_version_id: '10000000-0000-4000-8000-000000000006',
            name: 'Unrelated results',
            description: null,
            lifecycle: 'active',
            revision: 1,
          },
        ]
      }
      return []
    }),
  } as unknown as DataClient
}

function mount(props: { client?: DataClient; workspaceId?: string }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <SheetDefinitionUpgradeForm
        preview={preview}
        targetParameters={targetParameters}
        decisionDrafts={{}}
        parameterDrafts={{}}
        onDecisionChange={vi.fn()}
        onParameterChange={vi.fn()}
        client={props.client}
        workspaceId={props.workspaceId}
      />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('SheetDefinitionUpgradeForm source bindings', () => {
  it('resolves definition bindings through the shared contract vocabulary', async () => {
    mount({ client: client(), workspaceId: 'workspace-1' })
    expect(await screen.findByText('Target source bindings')).toBeTruthy()
    expect(
      await screen.findByRole('option', { name: 'Purification results' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('option', { name: 'Unrelated results' }),
    ).toBeNull()
    expect(screen.getByText(/· Required · exact/)).toBeTruthy()
  })

  it('falls back to raw object-ID inputs without a data client', () => {
    mount({})
    expect(screen.getByText('Target parameters')).toBeTruthy()
    expect(screen.getByPlaceholderText('Enter object ID')).toBeTruthy()
    expect(screen.queryByText('Target source bindings')).toBeNull()
  })
})
