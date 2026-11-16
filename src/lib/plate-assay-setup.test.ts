import { describe, expect, it } from 'vitest'

import { defaultAssayConfig } from './plate-assay'
import type { AssayWell } from './plate-assay'
import {
  controlColumnsOfWells,
  readAssaySetup,
  sameAssayConfig,
  writeColumnList,
} from './plate-assay-setup'

function column(n: number, role: AssayWell['role']): AssayWell[] {
  return 'ABCDEFGH'.split('').map((row) => ({ wellCode: `${row}${n}`, role }))
}

describe('writeColumnList', () => {
  it('writes the shortest list a person would', () => {
    expect(writeColumnList([12, 11, 1, 3])).toBe('1, 3, 11-12')
    expect(writeColumnList([])).toBe('')
    expect(writeColumnList([2, 2])).toBe('2')
  })
})

describe('controlColumnsOfWells', () => {
  it('finds the columns that are wholly one control', () => {
    const wells = [
      ...column(1, 'negative_control'),
      ...column(2, 'sample'),
      ...column(11, 'positive_control'),
      ...column(12, 'positive_control'),
    ]

    expect(controlColumnsOfWells(wells)).toEqual({
      negative: '1',
      positive: '11-12',
    })
  })

  it('leaves a mixed column out and says nothing for a plate with no controls', () => {
    const mixed = [
      { wellCode: 'A1', role: 'negative_control' as const },
      { wellCode: 'B1', role: 'sample' as const },
    ]

    expect(controlColumnsOfWells(mixed)).toEqual({ negative: '', positive: '' })
    expect(controlColumnsOfWells([])).toEqual({ negative: '', positive: '' })
  })
})

describe('readAssaySetup', () => {
  it('reads a stored setup and fills missing settings from the defaults', () => {
    const setup = readAssaySetup({
      config: { curveModel: '5pl' },
      negativeColumns: '1',
      positiveColumns: '12',
    })

    expect(setup?.negativeColumns).toBe('1')
    expect(setup?.config.curveModel).toBe('5pl')
    expect(setup?.config.normalisation).toBe(defaultAssayConfig().normalisation)
  })

  it('gives nothing for a design with no setup or an unreadable one', () => {
    expect(readAssaySetup(null)).toBeNull()
    expect(readAssaySetup('nope')).toBeNull()
    expect(readAssaySetup({ negativeColumns: '1' })).toBeNull()
  })
})

describe('sameAssayConfig', () => {
  it('compares what analyses a plate, not how it was stored', () => {
    const a = defaultAssayConfig()

    expect(sameAssayConfig(a, { ...a })).toBe(true)
    expect(sameAssayConfig(a, { ...a, curveModel: '5pl' })).toBe(false)
  })
})
