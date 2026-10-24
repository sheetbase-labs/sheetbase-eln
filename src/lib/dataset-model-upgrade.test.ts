import { describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  applyDatasetModelUpgrade,
  describeUpgradeEffects,
  fetchDatasetModelPosition,
} from './dataset-model-upgrade'
import type { DatasetModelUpgradePreview } from './dataset-model-upgrade'

function client(responses: Record<string, unknown>) {
  const fetcher = vi.fn(
    async (url: string | URL | Request, _init?: RequestInit) => {
      const href = String(url)
      const hit = Object.entries(responses).find(([key]) => href.includes(key))
      return new Response(JSON.stringify(hit?.[1] ?? []), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  )
  return { fetcher, data: createDataClient(fetcher) }
}

describe('fetchDatasetModelPosition', () => {
  it('reads the revision, the current version and the published versions ahead', async () => {
    const { data, fetcher } = client({
      '/datasets?': [{ revision: '7', schema_version_id: 'v1' }],
      'id=eq.v1': [{ id: 'v1', schema_id: 's', version: 1 }],
      'version=gt.1': [{ id: 'v2', version: 2 }],
    })
    const position = await fetchDatasetModelPosition(data, 'd1')
    expect(position).toEqual({
      datasetRevision: 7,
      currentVersionId: 'v1',
      currentVersion: 1,
      newer: [{ id: 'v2', version: 2 }],
    })
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain(
      'lifecycle=eq.active',
    )
  })

  it('returns null for a dataset the viewer cannot see', async () => {
    const { data } = client({})
    expect(await fetchDatasetModelPosition(data, 'd1')).toBeNull()
  })
})

describe('applyDatasetModelUpgrade', () => {
  it('sends the revision the page last read', async () => {
    const { data, fetcher } = client({ apply_dataset_model_upgrade: {} })
    await applyDatasetModelUpgrade(data, {
      datasetId: 'd1',
      targetVersionId: 'v2',
      expectedRevision: 7,
    })
    const init = fetcher.mock.calls.at(-1)?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({
      p_dataset_id: 'd1',
      p_target_version_id: 'v2',
      p_expected_revision: 7,
    })
  })
})

describe('describeUpgradeEffects', () => {
  const base: DatasetModelUpgradePreview = {
    ok: true,
    blocked: false,
    reason: null,
    fromVersion: 1,
    toVersion: 2,
    toVersionId: 'v2',
    added: [],
    removed: [],
    retyped: [],
    requiredWithoutDefault: [],
    semanticChanges: [],
    rowCount: 3,
    datasetRevision: 7,
  }
  it('names the added fields and that no value moves', () => {
    const lines = describeUpgradeEffects({
      ...base,
      added: [{ key: 'notes', label: 'Notes', type: 'text' }],
    })
    expect(lines[0]).toMatch(/Adds Notes/)
    expect(lines[1]).toMatch(/3 rows keep every value/)
    expect(lines[1]).toMatch(/stay on v1/)
  })
  it('says so when only the version moves', () => {
    expect(describeUpgradeEffects(base)[0]).toMatch(/Only the version/)
  })
})
