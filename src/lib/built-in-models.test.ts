import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '#/lib/data-client'
import {
  BUILT_IN_MODELS,
  fieldKeyFromLabel,
  requireBuiltInModel,
  saveAddedFieldValues,
} from './built-in-models'

function fakeClient(rows: unknown[] = []) {
  const client = {
    list: vi.fn(async () => rows),
    count: vi.fn(async () => 0),
    rpc: vi.fn(async () => ({})),
    insert: vi.fn(),
    patch: vi.fn(async () => []),
    remove: vi.fn(),
  }
  return client as typeof client & DataClient
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
    const client = fakeClient()
    await saveAddedFieldValues(
      client,
      requireBuiltInModel('experiment'),
      'r1',
      {},
    )
    expect(client.list).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('writes a record through the history-keeping RPC at its current version', async () => {
    const client = fakeClient([{ metadata_version: 4, locked_at: null }])
    await saveAddedFieldValues(client, requireBuiltInModel('sample'), 'r1', {
      batch: 'B-7',
    })
    expect(client.rpc).toHaveBeenCalledWith('update_record_custom_fields', {
      p_record_id: 'r1',
      p_expected_metadata_version: 4,
      p_values: { batch: 'B-7' },
    })
  })

  it('refuses a signed record before writing', async () => {
    const client = fakeClient([
      { metadata_version: 4, locked_at: '2026-10-01T00:00:00Z' },
    ])
    await expect(
      saveAddedFieldValues(client, requireBuiltInModel('experiment'), 'r1', {
        cell_passage: 3,
      }),
    ).rejects.toMatchObject({ code: 'SB011' })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('merges into a project’s existing values', async () => {
    const client = fakeClient([{ custom_fields: { budget_code: 'BX-1' } }])
    await saveAddedFieldValues(client, requireBuiltInModel('project'), 'p1', {
      site: 'Oxford',
    })
    expect(client.patch).toHaveBeenCalledWith('projects', '?id=eq.p1', {
      custom_fields: { budget_code: 'BX-1', site: 'Oxford' },
    })
  })
})
