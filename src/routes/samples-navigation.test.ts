import { describe, expect, it } from 'vitest'

import { searchFromSamplesQuery } from './samples'

describe('samples navigation state', () => {
  it('keeps the selected stable sample ID while filters change', () => {
    expect(
      searchFromSamplesQuery(
        {
          pageIndex: 2,
          pageSize: 50,
          sorting: [{ id: 'title', desc: false }],
          grouping: ['sampleType'],
          filters: [],
        },
        'sample-uuid',
      ),
    ).toMatchObject({ selected: 'sample-uuid', page: 2, sort: 'title:asc' })
  })

  it('removes selection explicitly without changing the hierarchy state', () => {
    expect(
      searchFromSamplesQuery(
        {
          pageIndex: 0,
          pageSize: 50,
          sorting: [],
          grouping: ['sampleType'],
          filters: [],
        },
        null,
      ).selected,
    ).toBeUndefined()
  })
})
