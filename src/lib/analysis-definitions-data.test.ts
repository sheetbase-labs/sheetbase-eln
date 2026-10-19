/**
 * SCI-02 — saved-analysis-definition data layer tests. Verifies the
 * create/update/save/delete wrappers against a mocked DataClient and the
 * definition-specific source-revision capture over canonical Dataset
 * sources, mirroring the analysis_definitions persistence contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  captureDefinitionSourceRevisions,
  composeAnalysisDefinition,
  definitionNameFrom,
  createAnalysisDefinition,
  deleteAnalysisDefinition,
  saveAnalysisDefinition,
  updateAnalysisDefinition,
} from './analysis-definitions-data'
import type { AnalysisDefinitionWire } from './analysis-definitions-data'
import type { CanonicalDatasetSource } from './chart-data'
import type { DataClient } from './data-client'
import type { RegressionDefinition } from './analysis-definition'

const DATASET_ID = '11111111-1111-1111-8111-111111111111'

function source(
  overrides: Partial<CanonicalDatasetSource> = {},
): CanonicalDatasetSource {
  return {
    datasetId: DATASET_ID,
    name: 'Stability',
    workspaceId: 'ws-1',
    schemaVersionId: 'sv-1',
    schemaVersionNumber: 3,
    revision: 2,
    columns: [],
    ...overrides,
  }
}

const definition: RegressionDefinition = {
  definitionVersion: 1,
  kind: 'regression',
  datasets: [{ datasetId: DATASET_ID }],
  outcome: { fieldId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02' },
  predictor: { fieldId: 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01' },
  degree: 2,
}

function clientMock(): DataClient {
  return {
    list: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    rpc: vi.fn(),
    insert: vi.fn().mockResolvedValue({ id: 'new-id', version: 1 }),
    patch: vi.fn().mockResolvedValue([{ id: 'existing', version: 7 }]),
    remove: vi.fn().mockResolvedValue([]),
  }
}

let client: DataClient

beforeEach(() => {
  client = clientMock()
})

describe('captureDefinitionSourceRevisions', () => {
  it('records the schema version number and revision of every referenced dataset', () => {
    const revisions = captureDefinitionSourceRevisions([source()], definition)
    expect(revisions).toEqual([
      {
        datasetId: DATASET_ID,
        schemaVersionNumber: 3,
        revision: 2,
      },
    ])
  })

  it('records zeroed revisions when a referenced dataset is unknown', () => {
    const revisions = captureDefinitionSourceRevisions([], definition)
    expect(revisions).toEqual([
      {
        datasetId: DATASET_ID,
        schemaVersionNumber: 0,
        revision: 0,
      },
    ])
  })
})

describe('save/delete wrappers', () => {
  it('inserts with workspace + owner attribution on create', async () => {
    await createAnalysisDefinition(
      client,
      { name: 'Recovery fit', definition, source_revisions: [] },
      'ws-1',
      'user-1',
    )
    expect(client.insert).toHaveBeenCalledWith('analysis_definitions', {
      workspace_id: 'ws-1',
      owner_user_id: 'user-1',
      name: 'Recovery fit',
      definition,
      source_revisions: [],
    })
  })

  it('patches the full body (not a delta) on update so the trigger bumps the version', async () => {
    const saved: AnalysisDefinitionWire = {
      id: 'existing',
      workspace_id: 'ws-1',
      owner_user_id: 'user-1',
      name: 'Old name',
      version: 6,
      definition: null,
      source_revisions: [],
      created_at: '',
      updated_at: '',
    }
    const updated = await updateAnalysisDefinition(client, saved.id, {
      id: saved.id,
      name: 'New name',
      definition,
      source_revisions: [
        { datasetId: DATASET_ID, schemaVersionNumber: 3, revision: 2 },
      ],
    })
    expect(updated.version).toBe(7)
    expect(client.patch).toHaveBeenCalledWith(
      'analysis_definitions',
      '?id=eq.existing',
      { name: 'New name', definition, source_revisions: expect.any(Array) },
    )
  })

  it('routes saves through insert when no id is present and through patch otherwise', async () => {
    await saveAnalysisDefinition(
      client,
      { name: 'A', definition, source_revisions: [] },
      'ws',
      'u',
    )
    expect(client.insert).toHaveBeenCalledOnce()
    await saveAnalysisDefinition(
      client,
      { id: 'existing', name: 'B', definition, source_revisions: [] },
      'ws',
      'u',
    )
    expect(client.patch).toHaveBeenCalledOnce()
  })

  it('deletes through the RLS boundary by id filter', async () => {
    await deleteAnalysisDefinition(client, 'abc')
    expect(client.remove).toHaveBeenCalledWith(
      'analysis_definitions',
      '?id=eq.abc',
    )
  })
})

describe('composeAnalysisDefinition', () => {
  const clash = Object.assign(new Error('duplicate'), { code: '23505' })

  it('names the chart view and the statistic it joins', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'def-2' })
    await composeAnalysisDefinition({ rpc } as unknown as DataClient, {
      chartViewId: 'view-1',
      statisticDefinitionId: 'def-1',
      name: 'Dose response',
    })
    expect(rpc).toHaveBeenCalledWith('compose_analysis_definition', {
      p_chart_view_id: 'view-1',
      p_statistic_definition_id: 'def-1',
      p_name: 'Dose response',
    })
  })

  it('sends null for a chart with no statistic', async () => {
    const rpc = vi.fn().mockResolvedValue({ id: 'def-2' })
    await composeAnalysisDefinition({ rpc } as unknown as DataClient, {
      chartViewId: 'view-1',
      name: 'Dose response',
    })
    expect(rpc.mock.calls[0][1].p_statistic_definition_id).toBeNull()
  })

  it('retries a name already taken with a number, and gives up on other errors', async () => {
    const rpc = vi
      .fn()
      .mockRejectedValueOnce(clash)
      .mockResolvedValueOnce({ id: 'def-2' })
    await composeAnalysisDefinition({ rpc } as unknown as DataClient, {
      chartViewId: 'v',
      name: 'Dose response',
    })
    expect(rpc.mock.calls[1][1].p_name).toBe('Dose response 2')

    const failing = vi.fn().mockRejectedValue(new Error('denied'))
    await expect(
      composeAnalysisDefinition({ rpc: failing } as unknown as DataClient, {
        chartViewId: 'v',
        name: 'x',
      }),
    ).rejects.toThrow('denied')
    expect(failing).toHaveBeenCalledTimes(1)
  })
})

describe('definitionNameFrom', () => {
  it('keeps what the name check allows and trims the ends', () => {
    expect(definitionNameFrom('  Dose / response (24 h)!  ')).toBe(
      'Dose response 24 h',
    )
    expect(definitionNameFrom('---')).toBe('Analysis')
  })
  it('stays within 100 characters with a suffix', () => {
    const name = definitionNameFrom('a'.repeat(300), 3)
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.endsWith(' 3')).toBe(true)
  })
})
