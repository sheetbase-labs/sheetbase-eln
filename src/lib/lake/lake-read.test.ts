import { describe, expect, it } from 'vitest'

import { writeLakeParquet } from './lake-parquet'
import type { LakeColumn } from './lake-parquet'
import { readLakeParquet } from './lake-read'

describe('lake Parquet read back', () => {
  it('returns what writeLakeParquet wrote, as JSON a database can load', async () => {
    const columns: LakeColumn[] = [
      { name: 'id', type: 'int64' },
      { name: 'titre', type: 'float64' },
      { name: 'batch', type: 'varchar' },
      { name: 'released', type: 'boolean' },
      { name: 'taken_on', type: 'date' },
      { name: 'read_at', type: 'timestamptz' },
    ]

    const file = await writeLakeParquet(columns, [
      [
        9007199254740993n,
        1.5,
        'B-7',
        true,
        '2026-03-02',
        '2026-03-02T10:15:30.250Z',
      ],
      [2, null, null, false, null, null],
    ])

    expect(await readLakeParquet(file.bytes, columns)).toEqual([
      {
        id: '9007199254740993',
        titre: 1.5,
        batch: 'B-7',
        released: true,
        taken_on: '2026-03-02',
        read_at: '2026-03-02T10:15:30.250Z',
      },
      {
        id: '2',
        titre: null,
        batch: null,
        released: false,
        taken_on: null,
        read_at: null,
      },
    ])
  })

  it('leaves a column the file does not hold as null', async () => {
    const file = await writeLakeParquet(
      [{ name: 'a', type: 'varchar' }],
      [['x']],
    )

    expect(
      await readLakeParquet(file.bytes, [
        { name: 'a', type: 'varchar' },
        { name: 'b', type: 'int64' },
      ]),
    ).toEqual([{ a: 'x', b: null }])
  })
})
