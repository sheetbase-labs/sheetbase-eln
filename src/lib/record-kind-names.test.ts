import { afterEach, describe, expect, it } from 'vitest'

import { createDataClient } from '#/lib/data-client'

import {
  humanise,
  loadRecordKindNames,
  recordKindName,
  resetRecordKindNames,
} from './record-kind-names'

afterEach(resetRecordKindNames)

describe('recordKindName', () => {
  it('says the model name a lab gave, not the key said as words', async () => {
    const client = createDataClient(() =>
      Promise.resolve(
        Response.json([{ key: 'aav_vector', name: 'AAV vector' }]),
      ),
    )

    expect(recordKindName('aav_vector')).toBe('Aav vector')
    await loadRecordKindNames(client)
    expect(recordKindName('aav_vector')).toBe('AAV vector')
    expect(recordKindName('cell_line')).toBe('Cell line')
    expect(humanise('cellLine')).toBe('Cell line')
  })
})
