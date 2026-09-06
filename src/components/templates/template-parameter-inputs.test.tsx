import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import type { Parameter } from '#/lib/parameter'

import { TemplateParameterInputs } from './template-parameter-inputs'

const RECORD_ID = '10000000-0000-4000-8000-000000000001'
const DATASET_ID = '10000000-0000-4000-8000-000000000002'
const INCOMPATIBLE_DATASET_ID = '10000000-0000-4000-8000-000000000005'
const DATASET_VERSION_ID = '10000000-0000-4000-8000-000000000003'
const SCHEMA_VERSION_ID = '10000000-0000-4000-8000-000000000004'

const parameters: Parameter[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    key: 'sample',
    label: 'Sample',
    required: true,
    type: { kind: 'record', modelKey: 'sample' },
    constraints: {},
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    key: 'results',
    label: 'Results',
    required: true,
    type: {
      kind: 'dataset',
      contract: { mode: 'exact', schemaVersionId: SCHEMA_VERSION_ID },
    },
    constraints: {},
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    key: 'baseline',
    label: 'Baseline',
    required: false,
    type: {
      kind: 'dataset-version',
      contract: { mode: 'exact', schemaVersionId: SCHEMA_VERSION_ID },
    },
    constraints: {},
  },
]

function client(): DataClient {
  return {
    list: vi.fn(async (resource: string) => {
      if (resource === 'records') {
        return [
          {
            id: RECORD_ID,
            workspace_id: '10000000-0000-4000-8000-000000000010',
            project_id: null,
            folder_id: null,
            kind: 'sample',
            identifier: 'SAM-001',
            title: 'Reference sample',
            status: 'available',
            tags: [],
            structure_version: 1,
            metadata_version: 1,
            created_at: '2026-08-20T12:00:00.000Z',
            updated_at: '2026-08-20T12:00:00.000Z',
            archived_at: null,
            deleted_at: null,
            created_by_user_id: 'user-1',
            updated_by_user_id: null,
            locked_at: null,
            locked_by_revision_id: null,
          },
        ]
      }
      if (resource === 'datasets') {
        return [
          {
            id: DATASET_ID,
            workspace_id: '10000000-0000-4000-8000-000000000010',
            schema_version_id: SCHEMA_VERSION_ID,
            name: 'Purification results',
            description: null,
            lifecycle: 'active',
            revision: 1,
          },
          {
            id: INCOMPATIBLE_DATASET_ID,
            workspace_id: '10000000-0000-4000-8000-000000000010',
            schema_version_id: '10000000-0000-4000-8000-000000000006',
            name: 'Unrelated results',
            description: null,
            lifecycle: 'active',
            revision: 1,
          },
        ]
      }
      if (resource === 'dataset_schema_version_fields') return []
      if (resource === 'dataset_schema_versions') {
        return [{ id: SCHEMA_VERSION_ID, schema_id: 'schema-1', version: 1 }]
      }
      if (resource === 'dataset_schema_definitions') {
        return [{ id: 'schema-1', name: 'Results', key: 'results' }]
      }
      if (resource === 'dataset_versions') {
        return [
          {
            id: DATASET_VERSION_ID,
            dataset_id: DATASET_ID,
            workspace_id: '10000000-0000-4000-8000-000000000010',
            schema_version_id: SCHEMA_VERSION_ID,
            source_dataset_revision: 1,
            label: 'Before purification',
            created_at: '2026-08-20T12:00:00.000Z',
            created_by_user_id: 'user-1',
          },
        ]
      }
      return []
    }),
  } as unknown as DataClient
}

afterEach(cleanup)

describe('TemplateParameterInputs', () => {
  it('uses governed record, Dataset, and Dataset Version selectors', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <TemplateParameterInputs
          client={client()}
          workspaceId="workspace-1"
          parameters={parameters}
          values={{}}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    )

    expect(
      await screen.findByRole('option', { name: 'SAM-001 · Reference sample' }),
    ).toBeTruthy()
    expect(
      await screen.findByRole('option', { name: 'Purification results' }),
    ).toBeTruthy()
    expect(
      screen.queryByRole('option', { name: 'Unrelated results' }),
    ).toBeNull()
    expect(
      await screen.findByRole('option', {
        name: 'Purification results · Before purification',
      }),
    ).toBeTruthy()
  })

  it('explains a failed selector query and lets the user retry', async () => {
    const list = vi.fn().mockRejectedValue(new Error('offline'))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <TemplateParameterInputs
          client={{ list } as unknown as DataClient}
          workspaceId="workspace-1"
          parameters={[parameters[0]]}
          values={{}}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load records.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })
})

describe('TemplateParameterInputs defaults and requirements', () => {
  const defaulted: Parameter[] = [
    {
      id: '20000000-0000-4000-8000-000000000010',
      key: 'passages',
      label: 'Passages',
      required: true,
      type: { kind: 'scalar', valueType: 'integer' },
      defaultValue: 5,
      constraints: {},
    },
    {
      id: '20000000-0000-4000-8000-000000000011',
      key: 'note',
      label: 'Note',
      required: false,
      type: { kind: 'scalar', valueType: 'text' },
      constraints: {},
    },
  ]

  function mount(
    parameters: Parameter[],
    props: { disabled?: boolean; values?: Record<string, string> } = {},
  ) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <TemplateParameterInputs
          client={client()}
          workspaceId="workspace-1"
          parameters={parameters}
          values={props.values ?? {}}
          onChange={vi.fn()}
          disabled={props.disabled}
        />
      </QueryClientProvider>,
    )
  }

  it('marks required parameters and surfaces declared defaults', () => {
    mount(defaulted)
    expect(screen.getByText(/· Required · default 5/)).toBeTruthy()
    expect(screen.getByText(/· Optional/)).toBeTruthy()
    expect(screen.getByPlaceholderText('Default: 5')).toBeTruthy()
    expect(screen.getByPlaceholderText('Enter a value')).toBeTruthy()
  })

  it('shows a pre-filled default value visibly once seeded', () => {
    mount(defaulted, {
      values: { '20000000-0000-4000-8000-000000000010': '5' },
    })
    expect(screen.getByDisplayValue('5')).toBeTruthy()
  })

  it('disables every input when the form is disabled', () => {
    mount([...parameters, ...defaulted], { disabled: true })
    for (const parameter of [...parameters, ...defaulted]) {
      const input = document.getElementById(
        `template-parameter-${parameter.id}`,
      ) as HTMLInputElement | HTMLSelectElement | null
      expect(input?.disabled).toBe(true)
    }
  })
})
