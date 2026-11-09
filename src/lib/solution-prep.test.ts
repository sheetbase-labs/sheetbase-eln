import { describe, expect, it, vi } from 'vitest'

import {
  earliestExpiry,
  fetchPreparedWith,
  isUsableIngredient,
  prepareSolution,
  searchIngredientLots,
} from './solution-prep'
import type { DataClient } from './data-client'

const NOW = new Date('2026-11-04T09:00:00Z')

describe('earliestExpiry', () => {
  it('takes the earliest date and ignores lots with none', () => {
    expect(earliestExpiry(['2027-03-01', null, '2026-12-15', undefined])).toBe(
      '2026-12-15',
    )
  })
  it('is empty when no lot expires', () => {
    expect(earliestExpiry([null, undefined])).toBeNull()
    expect(earliestExpiry([])).toBeNull()
  })
})

describe('isUsableIngredient', () => {
  const base = {
    status: 'available',
    quantity: 5,
    expiry: '2027-01-01',
    archivedAt: null,
  }

  it('accepts an in-date lot with stock', () => {
    expect(isUsableIngredient(base, NOW)).toBe(true)
    expect(isUsableIngredient({ ...base, expiry: null }, NOW)).toBe(true)
  })
  it('refuses expired, held, empty and archived lots', () => {
    expect(isUsableIngredient({ ...base, expiry: '2026-11-01' }, NOW)).toBe(
      false,
    )
    expect(isUsableIngredient({ ...base, status: 'quarantined' }, NOW)).toBe(
      false,
    )
    expect(isUsableIngredient({ ...base, quantity: 0 }, NOW)).toBe(false)
    expect(isUsableIngredient({ ...base, archivedAt: '2026-10-01' }, NOW)).toBe(
      false,
    )
  })
})

function client(list: unknown[] = []) {
  return {
    rpc: vi.fn(async () => ({ id: 'new' })),
    list: vi.fn(async () => list),
  } as unknown as DataClient & {
    rpc: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
  }
}

describe('prepareSolution', () => {
  it('sends the ingredients and leaves the expiry to the database by default', async () => {
    const c = client()
    await prepareSolution(c, {
      projectId: 'p1',
      title: '10x PBS',
      lot: 'PBS-1',
      quantity: 500,
      unit: 'mL',
      ingredients: [{ recordId: 'a', quantity: 80 }],
    })
    expect(c.rpc).toHaveBeenCalledWith('prepare_solution', {
      p_project_id: 'p1',
      p_title: '10x PBS',
      p_lot: 'PBS-1',
      p_quantity: 500,
      p_unit: 'mL',
      p_ingredients: [{ recordId: 'a', quantity: 80 }],
      p_expiry: null,
      p_storage: null,
      p_note: null,
    })
  })
})

describe('searchIngredientLots', () => {
  it('searches by name, ID and lot number, only for lots that can be used', async () => {
    const c = client()
    await searchIngredientLots(c, 'tris, "x"')
    const query = c.list.mock.calls[0][1] as string
    expect(query).toContain('status=in.(available,reserved)')
    expect(query).toContain('archived_at=is.null')
    expect(query).toContain('properties->>lot.ilike.')
    // Delimiters in what was typed are dropped so they cannot add a second condition.
    expect(decodeURIComponent(query)).toContain('"*tris   x*"')
  })
})

describe('fetchPreparedWith', () => {
  it('maps each use to the solution it made and skips unreadable ones', async () => {
    const c = client([
      {
        id: 'i1',
        quantity: '12.5',
        unit: 'g',
        created_at: '2026-11-03T10:00:00Z',
        product: { id: 'r1', identifier: 'MAT-0009', title: '10x PBS' },
      },
      {
        id: 'i2',
        quantity: '1',
        unit: 'g',
        created_at: '2026-11-03T10:00:00Z',
        product: null,
      },
    ])

    const used = await fetchPreparedWith(c, 'lot-1')
    expect(used).toEqual([
      {
        id: 'i1',
        productId: 'r1',
        identifier: 'MAT-0009',
        title: '10x PBS',
        quantity: 12.5,
        unit: 'g',
        createdAt: '2026-11-03T10:00:00Z',
      },
    ])
  })
})
