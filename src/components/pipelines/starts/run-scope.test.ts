import { describe, expect, it } from 'vitest'

import { runScope } from './run-scope'

const event = {
  id: 's1',
  kind: 'event',
  enabled: true,
  spec: { eventType: 'dataset.versioned', datasetId: 'ds-1' },
}

describe('runScope', () => {
  it('names the Datasets read and the one appended to', () => {
    const lines = runScope(
      { output: { mode: 'append', datasetId: 'ds-2' }, steps: [] },
      // SAFETY: only the fields the helper reads are given.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- test fixture.
      [event] as unknown as Parameters<typeof runScope>[1],
      new Map([
        ['ds-1', 'Titre'],
        ['ds-2', 'Step yield'],
      ]),
    )

    expect(lines.map((line) => line.text)).toEqual([
      'Reads Titre',
      'Appends to Step yield',
    ])
  })

  it('counts notification steps and says nothing for an empty config', () => {
    expect(runScope(null, [], new Map())).toEqual([])

    const lines = runScope(
      { steps: [{ kind: 'notify' }, { kind: 'notify' }] },
      [],
      new Map(),
    )

    expect(lines.map((line) => line.text)).toEqual([
      'Posts to 2 notification channels',
    ])
  })
})
