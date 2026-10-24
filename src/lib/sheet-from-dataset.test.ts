import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  fetchDatasetSheetOptions,
  openDatasetInSheet,
  startingSheetState,
} from './sheet-from-dataset'
import { validSheetInstanceState } from './sheet-instance.test'

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function listClient(answers: Record<string, unknown>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = Object.keys(answers).find((k) => url.includes(k))
    return new Response(JSON.stringify(key ? answers[key] : []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return { client: createDataClient(fetcher), fetcher }
}

describe('fetchDatasetSheetOptions', () => {
  it('sorts server-checked options and preserves refusals for the chosen Dataset', async () => {
    const { client } = listClient({
      '/rpc/dataset_sheet_options': [
        {
          versionId: ID(12),
          definitionId: ID(1),
          definitionName: 'Titre sheet',
          version: 2,
          datasetParameterId: ID(100),
          unavailableReason: null,
        },
        {
          versionId: ID(31),
          definitionId: ID(3),
          definitionName: 'Aardvark',
          version: 4,
          datasetParameterId: null,
          unavailableReason: 'Required input is missing',
        },
      ],
    })
    const options = await fetchDatasetSheetOptions(client, ID(80))
    expect(options.map((o) => [o.definitionName, o.version])).toEqual([
      ['Aardvark', 4],
      ['Titre sheet', 2],
    ])
    expect(options[1]).toMatchObject({
      versionId: ID(12),
      datasetParameterId: ID(100),
    })
    expect(options[0]).toMatchObject({
      datasetParameterId: null,
      unavailableReason: 'Required input is missing',
    })
  })
})

describe('openDatasetInSheet', () => {
  it('creates the sheet from the definition with the dataset bound to its input', async () => {
    const wire = {
      id: ID(50),
      workspace_id: ID(60),
      project_id: ID(70),
      notebook_record_id: null,
      source_definition_version_id: ID(12),
      name: 'Titre',
      description: null,
      lifecycle: 'active',
      revision: '1',
      state: validSheetInstanceState(),
      duplicated_from_instance_id: null,
      created_at: '2026-08-14T10:00:00Z',
      updated_at: '2026-08-14T10:00:00Z',
      created_by_user_id: 'user',
      updated_by_user_id: 'user',
    }
    const identity = {
      formatVersion: 1,
      kind: 'source',
      columnIds: [ID(101)],
      logicalTypes: ['reference'],
      sourceBindingId: ID(102),
      sourceFieldId: ID(103),
    }
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify(
            String(url).includes('resolve_sheet_instance_row_identity')
              ? {
                  ...wire,
                  revision: '2',
                  state: { ...wire.state, resolvedRowIdentity: identity },
                }
              : wire,
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    )
    const client = createDataClient(fetcher)
    const instance = await openDatasetInSheet(client, {
      workspaceId: ID(60),
      name: '  Titre  ',
      option: { versionId: ID(12), datasetParameterId: ID(100) },
      datasetId: ID(80),
      projectId: ID(70),
    })
    expect(instance.state.resolvedRowIdentity).toEqual(identity)
    expect(instance.revision).toBe(2)
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      '/rpc/create_sheet_instance_from_definition',
    )
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      p_name: 'Titre',
      p_source_definition_version_id: ID(12),
      p_project_id: ID(70),
      p_parameter_inputs: [
        { parameterId: ID(100), kind: 'dataset', datasetId: ID(80) },
      ],
    })
    fetcher
      .mockImplementationOnce(
        async () => new Response(JSON.stringify(wire), { status: 200 }),
      )
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                category: 'conflict',
                message: 'Row identity resolution refused',
              },
            }),
            { status: 409 },
          ),
      )
    await expect(
      openDatasetInSheet(client, {
        workspaceId: ID(60),
        name: 'Titre',
        option: { versionId: ID(12), datasetParameterId: ID(100) },
        datasetId: ID(80),
        projectId: ID(70),
      }),
    ).rejects.toThrow('Row identity resolution refused')
  })

  it('starts from an empty state the definition then fills in', () => {
    expect(startingSheetState()).toMatchObject({
      bindings: [],
      localFields: [],
      localValues: {},
    })
  })
})
