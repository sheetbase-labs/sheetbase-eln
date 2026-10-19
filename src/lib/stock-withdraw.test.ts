import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { isWithdrawn, withdrawItemFromStock } from './stock-withdraw'

const lotWire = (props: Record<string, unknown>) => ({
  id: 'lot-1',
  identifier: 'RGT-1',
  kind: 'material',
  title: 'Buffer',
  status: 'available',
  tags: [],
  metadata_version: 4,
  properties: props,
  custom_fields: {},
})

function client(opts: { lot?: unknown; sample?: unknown }) {
  const rpc = vi.fn(async (name: string) =>
    name === 'withdraw_sample'
      ? { sample: lotWire({}), derivedSampleId: null, derivedSample: null }
      : {},
  )
  const list = vi.fn(async (_t: string, q: string) => {
    if (q.includes('select=identifier')) return [{ identifier: 'EXP-9' }]
    if (q.includes('kind=eq.sample')) return opts.sample ? [opts.sample] : []
    return opts.lot ? [opts.lot] : []
  })
  return { rpc, list, c: { rpc, list } as unknown as DataClient }
}

const item = (over = {}) => ({
  kind: 'material' as const,
  materialRecordId: 'lot-1',
  identifier: 'RGT-1',
  quantity: 5,
  unit: { symbol: 'mL' },
  ...over,
})

describe('withdrawItemFromStock', () => {
  it('consumes a lot with the experiment as the reason', async () => {
    const { rpc, c } = client({ lot: lotWire({ quantity: 20, unit: 'mL' }) })
    const out = await withdrawItemFromStock(c, item(), { id: 'exp-9' })
    expect(rpc).toHaveBeenCalledWith('record_reagent_movement', {
      p_reagent_record_id: 'lot-1',
      p_operation: 'consume',
      p_quantity_delta: 5,
      p_reason: 'Used in EXP-9',
      p_expected_metadata_version: 4,
    })
    expect(isWithdrawn({ note: out.note })).toBe(true)
  })

  it('refuses a unit that is not the stock unit, naming both', async () => {
    const { rpc, c } = client({ lot: lotWire({ quantity: 20, unit: 'L' }) })
    await expect(
      withdrawItemFromStock(c, item(), { id: 'exp-9' }),
    ).rejects.toThrow('stocked in L, but this block uses mL')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses more than is in stock', async () => {
    const { rpc, c } = client({ lot: lotWire({ quantity: 2, unit: 'mL' }) })
    await expect(
      withdrawItemFromStock(c, item(), { id: 'exp-9' }),
    ).rejects.toThrow('Only 2 mL of RGT-1 is in stock.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('withdraws a sample for the experiment', async () => {
    const { rpc, c } = client({
      sample: {
        ...lotWire({ quantity: 10, quantityUnit: 'mL' }),
        kind: 'sample',
      },
    })
    await withdrawItemFromStock(
      c,
      item({ kind: 'sample', materialRecordId: 'lot-1' }),
      { id: 'exp-9' },
    )
    expect(rpc).toHaveBeenCalledWith(
      'withdraw_sample',
      expect.objectContaining({
        p_record_id: 'lot-1',
        p_quantity: 5,
        p_purpose_experiment_id: 'exp-9',
        p_unit: 'mL',
      }),
    )
  })

  it('refuses a zero amount', async () => {
    const { c } = client({ lot: lotWire({}) })
    await expect(
      withdrawItemFromStock(c, item({ quantity: 0 }), { id: 'e' }),
    ).rejects.toThrow('above zero')
  })
})
