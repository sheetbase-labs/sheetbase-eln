import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { createDataClient } from '#/lib/data-client'
import {
  BUILT_IN_MODELS,
  fieldKeyFromLabel,
  requireBuiltInModel,
  saveAddedFieldValues,
} from './built-in-models'

function recordingClient(rows: z.core.util.JSONType[] = []) {
  const requests: Request[] = []

  const client = createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://localhost'),
      init,
    )

    requests.push(request)

    return Response.json(request.method === 'GET' ? rows : {})
  })

  return { client, requests }
}

describe('built-in models', () => {
  it('lists the models a workspace can extend, and no core infrastructure', () => {
    expect(BUILT_IN_MODELS.map((model) => model.key)).toEqual([
      'experiment',
      'sample',
      'material',
      'protocol_template',
      'project',
      'instrument',
    ])
    expect(() => requireBuiltInModel('user')).toThrow()
  })

  it('makes a stable key from a label, avoiding every key the model uses', () => {
    expect(fieldKeyFromLabel('Cell passage', new Set())).toBe('cell_passage')
    expect(fieldKeyFromLabel('  pH (at 25 °C) ', new Set())).toBe('ph_at_25_c')
    expect(fieldKeyFromLabel('2nd read', new Set())).toBe('f_2nd_read')
    expect(fieldKeyFromLabel('***', new Set())).toBe('field')
    expect(fieldKeyFromLabel('Status', new Set(['status', 'status_2']))).toBe(
      'status_3',
    )
  })
})

describe('saveAddedFieldValues', () => {
  it('writes nothing when there is nothing to save', async () => {
    const { client, requests } = recordingClient()
    await saveAddedFieldValues(
      client,
      requireBuiltInModel('experiment'),
      'r1',
      {},
    )
    expect(requests).toHaveLength(0)
  })

  it('writes a record through the history-keeping RPC at its current version', async () => {
    const { client, requests } = recordingClient([
      { metadata_version: 4, locked_at: null },
    ])

    await saveAddedFieldValues(client, requireBuiltInModel('sample'), 'r1', {
      batch: 'B-7',
    })
    expect(new URL(requests[1].url).pathname).toBe(
      '/api/db/rpc/update_record_custom_fields',
    )
    expect(requests[1].method).toBe('POST')
    expect(await requests[1].json()).toEqual({
      p_record_id: 'r1',
      p_expected_metadata_version: 4,
      p_values: { batch: 'B-7' },
    })
  })

  it('refuses a signed record before writing', async () => {
    const { client, requests } = recordingClient([
      { metadata_version: 4, locked_at: '2026-10-01T00:00:00Z' },
    ])

    await expect(
      saveAddedFieldValues(client, requireBuiltInModel('experiment'), 'r1', {
        cell_passage: 3,
      }),
    ).rejects.toMatchObject({ code: 'SB011' })
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('merges into a project’s existing values', async () => {
    const { client, requests } = recordingClient([
      { custom_fields: { budget_code: 'BX-1' } },
    ])

    await saveAddedFieldValues(client, requireBuiltInModel('project'), 'p1', {
      site: 'Oxford',
    })
    expect(new URL(requests[1].url).pathname).toBe('/api/db/projects')
    expect(new URL(requests[1].url).searchParams.get('id')).toBe('eq.p1')
    expect(requests[1].method).toBe('PATCH')
    expect(await requests[1].json()).toEqual({
      custom_fields: { budget_code: 'BX-1', site: 'Oxford' },
    })
  })
})
