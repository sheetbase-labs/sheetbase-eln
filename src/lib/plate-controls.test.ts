import { describe, expect, it } from 'vitest'

import { suggestControlColumns } from './plate-controls'
import type { PlateReadout } from './plate-assay'

function plate(
  value: (row: number, col: number) => number,
  cols = 12,
  rows = 8,
): PlateReadout {
  const readout: PlateReadout = {}

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      readout[`${String.fromCharCode(65 + r)}${c + 1}`] = value(r, c)

  return readout
}

const wobble = (r: number, c: number) => ((r * 7 + c * 3) % 5) * 300

describe('suggestControlColumns', () => {
  it('finds a no-effect column and a full-effect column at the edges', () => {
    const readout = plate((r, c) =>
      c === 0
        ? 52000 + wobble(r, c)
        : c === 11
          ? 3200 + wobble(r, c)
          : 50000 + wobble(r, c) * 3,
    )

    expect(suggestControlColumns(readout)).toMatchObject({
      negative: '1',
      positive: '12',
    })
  })

  it('puts the no-effect label on whichever edge reads like the samples', () => {
    const readout = plate((r, c) =>
      c === 0
        ? 3200 + wobble(r, c)
        : c === 11
          ? 52000 + wobble(r, c)
          : 50000 + wobble(r, c) * 3,
    )

    expect(suggestControlColumns(readout)).toMatchObject({
      negative: '12',
      positive: '1',
    })
  })

  it('is not fooled by a few hits among the samples', () => {
    const readout = plate((r, c) =>
      c === 0
        ? 52000
        : c === 11
          ? 3200
          : r === 2 && c === 5
            ? 9000
            : 50000 + wobble(r, c),
    )

    expect(suggestControlColumns(readout)).not.toBeNull()
  })

  it('offers nothing for a plate of samples', () => {
    expect(
      suggestControlColumns(plate((r, c) => 50000 + wobble(r, c) * 4)),
    ).toBeNull()
  })

  it('offers nothing for a small or sparse plate', () => {
    expect(suggestControlColumns({ A1: 1, A2: 2 })).toBeNull()
  })
})
