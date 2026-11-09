import { describe, expect, it } from 'vitest'

import { writeLakeParquet } from './lake-parquet'

describe('lake Parquet', () => {
  it('writes typed columns with counts and bounds', async () => {
    const file = await writeLakeParquet(
      [
        { name: 'id', type: 'int64' },
        { name: 'od', type: 'float64' },
        { name: 'strain', type: 'varchar' },
        { name: 'ok', type: 'boolean' },
        { name: 'on', type: 'date' },
        { name: 'at', type: 'timestamptz' },
      ],
      [
        [1, 0.5, 'K-12', true, '2026-11-01', '2026-11-01T10:00:00Z'],
        [2, null, 'BL21', false, '2026-11-02', '2026-11-02T10:00:00Z'],
        [3, 1.5, null, null, null, null],
      ],
    )

    expect(file.recordCount).toBe(3)
    // Parquet files start and end with PAR1.
    const head = Buffer.from(file.bytes.subarray(0, 4)).toString()

    const tail = Buffer.from(
      file.bytes.subarray(file.bytes.length - 4),
    ).toString()

    expect([head, tail]).toEqual(['PAR1', 'PAR1'])
    expect(file.footerSize).toBeGreaterThan(0)
    expect(file.stats[1]).toMatchObject({
      valueCount: 2,
      nullCount: 1,
      min: '0.5',
      max: '1.5',
    })
    expect(file.stats[2]).toMatchObject({ valueCount: 2, nullCount: 1 })
  })
})
