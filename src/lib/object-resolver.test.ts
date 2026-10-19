import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import {
  resolveObjectByIdentifier,
  resolvedObjectPath,
} from './object-resolver'

/** A client whose tables answer from a map of `table` -> rows matching the query. */
function client(
  tables: Partial<Record<string, (query: string) => unknown[] | Error>>,
): DataClient {
  return {
    list: vi.fn(async (table: string, query: string) => {
      const answer = tables[table]?.(query) ?? []
      if (answer instanceof Error) throw answer
      return answer
    }),
  } as unknown as DataClient
}

describe('resolveObjectByIdentifier', () => {
  it('finds a record by identifier and sends it to the page that owns its kind', async () => {
    const found = await resolveObjectByIdentifier(
      client({
        records: () => [
          { id: 's-1', identifier: 'SMP-1', kind: 'sample', title: 'Lysate' },
        ],
      }),
      ' SMP-1 ',
    )
    expect(found).toMatchObject({ source: 'record', id: 's-1', kind: 'sample' })
    expect(resolvedObjectPath(found!)).toBe('/samples/s-1')
  })

  it('finds an instrument, a dataset or a project by display id', async () => {
    const tables = {
      instruments: (q: string) =>
        q.includes('display_id=eq.INS-0007')
          ? [{ id: 'i-1', display_id: 'INS-0007', name: 'Plate reader' }]
          : [],
      datasets: (q: string) =>
        q.includes('display_id=eq.DS-0311')
          ? [{ id: 'd-1', display_id: 'DS-0311', name: 'Titre run' }]
          : [],
      projects: (q: string) =>
        q.includes('display_id=eq.PRJ-0217')
          ? [{ id: 'p-1', display_id: 'PRJ-0217', title: 'Gene therapy' }]
          : [],
    }
    const c = client(tables)
    const instrument = await resolveObjectByIdentifier(c, 'INS-0007')
    expect(instrument).toMatchObject({
      source: 'registry',
      kind: 'instrument',
      title: 'Plate reader',
    })
    expect(resolvedObjectPath(instrument!)).toBe('/instruments/i-1')
    const dataset = await resolveObjectByIdentifier(c, 'DS-0311')
    expect(resolvedObjectPath(dataset!)).toBe('/datasets/d-1')
    const project = await resolveObjectByIdentifier(c, 'PRJ-0217')
    expect(resolvedObjectPath(project!)).toBe('/projects/p-1')
  })

  it('falls back to an alias and says which alias matched', async () => {
    const found = await resolveObjectByIdentifier(
      client({
        record_aliases: () => [{ record_id: 'r-1', alias: 'FRZ-A-12' }],
        records: (q) =>
          q.includes('id=eq.r-1')
            ? [
                {
                  id: 'r-1',
                  identifier: 'SMP-9',
                  kind: 'sample',
                  title: 'Tube',
                },
              ]
            : [],
      }),
      'FRZ-A-12',
    )
    expect(found).toMatchObject({ id: 'r-1', matchedAlias: 'FRZ-A-12' })
  })

  it('returns null for a code nothing matches', async () => {
    expect(await resolveObjectByIdentifier(client({}), 'NOPE-1')).toBeNull()
    expect(await resolveObjectByIdentifier(client({}), '  ')).toBeNull()
  })

  it('still resolves from a registry when another registry cannot be read', async () => {
    const found = await resolveObjectByIdentifier(
      client({
        datasets: () => new Error('forbidden'),
        instruments: () => [
          { id: 'i-2', display_id: 'INS-2', name: 'Balance' },
        ],
      }),
      'INS-2',
    )
    expect(found?.kind).toBe('instrument')
  })

  it('reports a failed lookup as an error, not as a miss', async () => {
    const failing = {
      list: vi.fn(async (table: string) => {
        if (table === 'records') return []
        throw new Error('down')
      }),
    } as unknown as DataClient
    await expect(resolveObjectByIdentifier(failing, 'DS-1')).rejects.toThrow(
      'down',
    )
  })
})
