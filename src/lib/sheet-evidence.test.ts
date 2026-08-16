import { describe, expect, it } from 'vitest'

import { sheetEvidenceFromEnvelope } from './sheet-evidence'

describe('sheetEvidenceFromEnvelope', () => {
  it('indexes frozen Sheet evidence by block id', () => {
    const map = sheetEvidenceFromEnvelope({
      sheetEvidence: [
        {
          blockId: 'b1',
          instanceId: 'i1',
          instanceRevision: 3,
          sourceDefinitionVersionId: 'd1',
          instanceState: { localValues: { row: { field: 42 } } },
          datasetBindings: [{ datasetId: 'ds1', policyMode: 'live' }],
        },
      ],
    })
    expect(map.get('b1')?.instanceState).toEqual({
      localValues: { row: { field: 42 } },
    })
    expect(map.get('b1')?.datasetBindings).toHaveLength(1)
  })
})
