import { describe, expect, it } from 'vitest'

import {
  amountPatch,
  computeReactionTable,
  limitingRow,
  reactionIssues,
  structureIssues,
  syncRowsWithDrawing,
  formatAmount,
} from './chemistry'
import type { ReactionPayload, ReactionRow } from './chemistry'

const row = (
  patch: Partial<ReactionRow> & Pick<ReactionRow, 'id' | 'role'>,
): ReactionRow => ({
  name: patch.id,
  ...patch,
})

/** Aspirin: salicylic acid and acetic anhydride, with acid as the catalyst. */
const aspirin = (): ReactionPayload => ({
  drawing: '',
  rows: [
    row({ id: 'sal', role: 'reactant', mw: 138.12, massMg: 1000 }),
    row({
      id: 'anh',
      role: 'reactant',
      mw: 102.09,
      equiv: 1.5,
      density: 1.082,
    }),
    row({ id: 'acid', role: 'reagent', mw: 98.08, equiv: 0.05 }),
    row({ id: 'asa', role: 'product', mw: 180.16, massMg: 900 }),
  ],
})

describe('computeReactionTable', () => {
  it('measures every row against the limiting reactant', () => {
    const table = computeReactionTable(aspirin())
    expect(table.get('sal')).toMatchObject({ equiv: 1 })
    expect(table.get('sal')!.mmol).toBeCloseTo(7.24, 2)
    const anhydride = table.get('anh')!
    expect(anhydride.mmol).toBeCloseTo(10.86, 2)
    expect(anhydride.massMg).toBeCloseTo(1108.7, 0)
    // From the density: mg to g, over g/mL.
    expect(anhydride.volumeMl).toBeCloseTo(1.025, 2)
    expect(table.get('acid')!.massMg).toBeCloseTo(35.5, 1)
  })

  it('gives the theoretical mass and the yield for a product', () => {
    const asa = computeReactionTable(aspirin()).get('asa')!
    expect(asa.theoreticalMg).toBeCloseTo(1304.4, 0)
    expect(asa.yieldPercent).toBeCloseTo(69.0, 0)
  })

  it('works out equivalents from an amount typed for a non-limiting row', () => {
    const payload = aspirin()
    payload.rows[1] = row({
      id: 'anh',
      role: 'reactant',
      mw: 102.09,
      massMg: 1108.7,
    })
    expect(computeReactionTable(payload).get('anh')!.equiv).toBeCloseTo(1.5, 2)
  })

  it('takes the reactant that was measured out when none is chosen', () => {
    const payload: ReactionPayload = {
      drawing: '',
      rows: [
        row({ id: 'first', role: 'reactant', mw: 100, equiv: 2 }),
        row({ id: 'measured', role: 'reactant', mw: 50, massMg: 25 }),
      ],
    }
    expect(limitingRow(payload)!.id).toBe('measured')
    expect(computeReactionTable(payload).get('first')!.mmol).toBeCloseTo(1, 6)
  })

  it('uses a chosen limiting reactant, else the first reactant', () => {
    const payload = aspirin()
    expect(limitingRow(payload)!.id).toBe('sal')
    payload.limitingId = 'anh'
    expect(limitingRow(payload)!.id).toBe('anh')
    // An id that is not a reactant falls back to the first reactant.
    payload.limitingId = 'asa'
    expect(limitingRow(payload)!.id).toBe('sal')
  })

  it('takes moles from a volume and density, or from a volume and concentration', () => {
    const payload: ReactionPayload = {
      drawing: '',
      rows: [
        row({ id: 'a', role: 'reactant', mw: 100, volumeMl: 2, density: 0.5 }),
        row({
          id: 'b',
          role: 'reactant',
          mw: 50,
          equiv: 2,
          concentration: 0.5,
        }),
      ],
    }
    const table = computeReactionTable(payload)
    expect(table.get('a')!.mmol).toBeCloseTo(10, 6)
    expect(table.get('b')!.mmol).toBeCloseTo(20, 6)
    expect(table.get('b')!.volumeMl).toBeCloseTo(40, 6)
  })

  it('leaves out what cannot be worked out rather than guessing', () => {
    const payload: ReactionPayload = {
      drawing: '',
      rows: [
        row({ id: 'a', role: 'reactant', mw: 100 }),
        row({ id: 'b', role: 'reagent', equiv: 2 }),
        row({ id: 'p', role: 'product', mw: 50, massMg: 10 }),
      ],
    }
    const table = computeReactionTable(payload)
    expect(table.get('a')).toMatchObject({ mmol: null, massMg: null })
    expect(table.get('b')).toMatchObject({ mmol: null, massMg: null })
    expect(table.get('p')).toMatchObject({
      theoreticalMg: null,
      yieldPercent: null,
    })
  })

  it('does not divide by a zero or negative weight', () => {
    const payload: ReactionPayload = {
      drawing: '',
      rows: [row({ id: 'a', role: 'reactant', mw: 0, massMg: 10 })],
    }
    expect(computeReactionTable(payload).get('a')!.mmol).toBeNull()
  })
})

describe('syncRowsWithDrawing', () => {
  const sal = { structureCode: 'code-sal', formula: 'C7H6O3', mw: 138.12 }
  it('adds a row for a new molecule and keeps what was typed for one that stays', () => {
    const existing = [
      row({
        id: 'keep',
        role: 'reactant',
        name: 'Salicylic acid',
        massMg: 1000,
        ...sal,
      }),
    ]
    const rows = syncRowsWithDrawing(existing, [
      { role: 'reactant', ...sal },
      {
        role: 'product',
        structureCode: 'code-asa',
        formula: 'C9H8O4',
        mw: 180.16,
      },
    ])
    expect(rows.map((r) => [r.role, r.name, r.massMg])).toEqual([
      ['reactant', 'Salicylic acid', 1000],
      ['product', '', undefined],
    ])
    expect(rows[0].id).toBe('keep')
    expect(rows[1].id).not.toBe('keep')
  })

  it('drops a row whose molecule was erased and leaves hand-made rows', () => {
    const existing = [
      row({ id: 'gone', role: 'reactant', ...sal }),
      row({ id: 'thf', role: 'solvent', name: 'THF', volumeMl: 5 }),
    ]
    const rows = syncRowsWithDrawing(existing, [])
    expect(rows.map((r) => r.id)).toEqual(['thf'])
  })

  it('gives two drawn copies of one molecule their own rows', () => {
    const rows = syncRowsWithDrawing(
      [row({ id: 'one', role: 'reactant', ...sal })],
      [
        { role: 'reactant', ...sal },
        { role: 'reactant', ...sal },
      ],
    )
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
  })

  it('lists reactants, then reagents, solvents and products', () => {
    const rows = syncRowsWithDrawing(
      [row({ id: 's', role: 'solvent', name: 'DMF' })],
      [
        { role: 'product', structureCode: 'p', formula: 'X', mw: 1 },
        { role: 'reagent', structureCode: 'g', formula: 'Y', mw: 1 },
        { role: 'reactant', structureCode: 'r', formula: 'Z', mw: 1 },
      ],
    )
    expect(rows.map((r) => r.role)).toEqual([
      'reactant',
      'reagent',
      'solvent',
      'product',
    ])
  })
})

describe('payload checks', () => {
  it('accepts the empty starting payloads', () => {
    expect(structureIssues({ molfile: '' })).toEqual([])
    expect(reactionIssues({ drawing: '', rows: [] })).toEqual([])
  })

  it('names what is wrong with a structure', () => {
    expect(structureIssues({})[0].field).toBe('molfile')
    expect(structureIssues({ molfile: '', mw: 'heavy' })[0].field).toBe('mw')
  })

  it('names the row and field that are wrong in a reaction', () => {
    const fields = (payload: unknown) =>
      reactionIssues(payload).map((i) => i.field)
    const base = {
      drawing: '',
      rows: [{ id: 'a', role: 'reactant', name: 'A' }],
    }
    expect(fields(base)).toEqual([])
    expect(
      fields({ ...base, rows: [{ ...base.rows[0], role: 'catalyst' }] }),
    ).toEqual(['rows[0].role'])
    expect(
      fields({ ...base, rows: [{ ...base.rows[0], massMg: 'a lot' }] }),
    ).toEqual(['rows[0].massMg'])
    expect(fields({ ...base, rows: [base.rows[0], base.rows[0]] })).toEqual([
      'rows[1].id',
    ])
    expect(fields({ ...base, limitingId: 'nope' })).toEqual(['limitingId'])
    expect(fields({ drawing: '', rows: 'x' })).toEqual(['rows'])
  })
})

describe('formatAmount', () => {
  it('keeps enough digits and shows a dash for nothing', () => {
    expect(formatAmount(1108.6931)).toBe('1,109')
    expect(formatAmount(7.2437)).toBe('7.244')
    expect(formatAmount(null)).toBe('—')
  })
})

describe('amountPatch', () => {
  const reagent = row({ id: 'r', role: 'reagent', mw: 100, equiv: 2 })

  it('lets a typed amount replace equivalents, and equivalents replace amounts', () => {
    expect(amountPatch(reagent, 'massMg', 50)).toEqual({
      massMg: 50,
      equiv: null,
    })
    expect(amountPatch(reagent, 'volumeMl', 5)).toEqual({
      volumeMl: 5,
      equiv: null,
    })
    expect(
      amountPatch({ ...reagent, massMg: 50, volumeMl: 2 }, 'equiv', 1.5),
    ).toEqual({ equiv: 1.5, massMg: null, volumeMl: null })
  })

  it('leaves the other amounts alone when a value is cleared, or for a product', () => {
    expect(amountPatch(reagent, 'massMg', null)).toEqual({ massMg: null })
    const product = row({ id: 'p', role: 'product' })
    expect(amountPatch(product, 'massMg', 900)).toEqual({ massMg: 900 })
    expect(amountPatch(reagent, 'density', 1.1)).toEqual({ density: 1.1 })
  })
})
