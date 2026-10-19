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
  it('lists the newest published version of each definition that takes a dataset', async () => {
    const { client } = listClient({
      '/sheet_definitions': [
        { id: ID(1), name: 'Titre sheet', lifecycle: 'active' },
        { id: ID(2), name: 'Scalar only', lifecycle: 'active' },
        { id: ID(3), name: 'Aardvark', lifecycle: 'active' },
      ],
      '/sheet_definition_versions': [
        {
          id: ID(12),
          definition_id: ID(1),
          version: 2,
          configuration: {
            parameters: [{ id: ID(100), type: { kind: 'dataset' } }],
          },
        },
        {
          id: ID(11),
          definition_id: ID(1),
          version: 1,
          configuration: {
            parameters: [{ id: ID(101), type: { kind: 'dataset' } }],
          },
        },
        {
          id: ID(21),
          definition_id: ID(2),
          version: 1,
          configuration: {
            parameters: [{ id: ID(102), type: { kind: 'scalar' } }],
          },
        },
        {
          id: ID(31),
          definition_id: ID(3),
          version: 4,
          configuration: {
            parameters: [{ id: ID(103), type: { kind: 'dataset' } }],
          },
        },
      ],
    })
    const options = await fetchDatasetSheetOptions(client)
    expect(options.map((o) => [o.definitionName, o.version])).toEqual([
      ['Aardvark', 4],
      ['Titre sheet', 2],
    ])
    expect(options[1]).toMatchObject({
      versionId: ID(12),
      datasetParameterId: ID(100),
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
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(wire), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = createDataClient(fetcher)
    await openDatasetInSheet(client, {
      workspaceId: ID(60),
      name: '  Titre  ',
      option: { versionId: ID(12), datasetParameterId: ID(100) },
      datasetId: ID(80),
      projectId: ID(70),
    })
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      '/rpc/create_sheet_instance_from_definition',
    )
    expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toMatchObject({
      p_name: 'Titre',
      p_source_definition_version_id: ID(12),
      p_project_id: ID(70),
      p_parameter_inputs: [
        { parameterId: ID(100), kind: 'dataset', datasetId: ID(80) },
      ],
    })
  })

  it('starts from an empty state the definition then fills in', () => {
    expect(startingSheetState()).toMatchObject({
      bindings: [],
      localFields: [],
      localValues: {},
    })
  })
})
