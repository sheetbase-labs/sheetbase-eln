import { describe, expect, it } from 'vitest'
import {
  buildWorklist,
  parseRunLog,
  reconcileRunLog,
  withdrawalsFrom,
  wellPosition,
  writeWorklist,
} from './plate-worklist'
import type { DestinationWell } from './plate-worklist'

const dest: DestinationWell[] = [
  { wellCode: 'A1', sampleId: 's1', label: 'S-1', volumeUl: 10 },
  { wellCode: 'B1', sampleId: 's2', label: 'S-2', volumeUl: 10 },
  { wellCode: 'A2', sampleId: 's1', label: 'S-1', volumeUl: 5 },
  { wellCode: 'B2', sampleId: null, label: 'DMSO', volumeUl: null },
]
const base = { sourcePlate: 'SRC', sourceFormat: '384_well' as const, destPlate: 'DST', defaultVolumeUl: 2 }

describe('buildWorklist', () => {
  it('cherry-picks distinct samples into consecutive source wells', () => {
    const p = buildWorklist(dest, { ...base, mode: 'cherry_pick' })
    expect(p.transfers).toHaveLength(4)
    const s1 = p.transfers.filter((t) => t.sampleId === 's1')
    expect(new Set(s1.map((t) => t.sourceWell)).size).toBe(1)
    expect(p.sources.map((s) => s.well)).toEqual(['A1', 'B1', 'C1'])
    expect(p.sources[0].totalUl).toBe(15)
    expect(p.transfers.find((t) => t.label === 'DMSO')!.volumeUl).toBe(2)
  })
  it('stamps well to well', () => {
    const p = buildWorklist(dest, { ...base, mode: 'stamp' })
    expect(p.transfers.every((t) => t.sourceWell === t.destWell)).toBe(true)
  })
  it('reports problems instead of hiding them', () => {
    const p = buildWorklist(
      [...dest, { wellCode: 'C3', label: 'x', volumeUl: null }],
      { ...base, mode: 'cherry_pick', defaultVolumeUl: undefined, sourceWellVolumeUl: 12, maxVolumeUl: 8 },
    )
    const codes = p.issues.map((i) => i.code)
    expect(codes).toContain('no_volume')
    expect(codes).toContain('source_overdraw')
    expect(codes).toContain('volume_too_large')
  })
  it('runs out of source wells', () => {
    const p = buildWorklist(dest, { ...base, mode: 'cherry_pick', sourceFormat: '6_well' })
    expect(p.issues.filter((i) => i.code === 'source_plate_full')).toHaveLength(0)
    const many = Array.from({ length: 8 }, (_, i) => ({ wellCode: `A${i + 1}`, sampleId: `x${i}`, label: `x${i}`, volumeUl: 1 }))
    expect(buildWorklist(many, { ...base, mode: 'cherry_pick', sourceFormat: '6_well', destFormat: '96_well' }).issues.some((i) => i.code === 'source_plate_full')).toBe(true)
  })
})

describe('writers', () => {
  const plan = buildWorklist(dest, { ...base, mode: 'cherry_pick' })
  const opts = { sourceFormat: '384_well' as const, destFormat: '96_well' as const }
  it('counts positions down columns', () => {
    expect(wellPosition('A1', 8)).toBe(1)
    expect(wellPosition('B1', 8)).toBe(2)
    expect(wellPosition('A2', 8)).toBe(9)
  })
  it('writes each format', () => {
    expect(writeWorklist('csv', plan.transfers, opts).split('\n')).toHaveLength(5)
    const echo = writeWorklist('echo', plan.transfers, opts)
    expect(echo).toContain('Transfer Volume')
    expect(echo).toContain('10000')
    const gwl = writeWorklist('tecan_gwl', plan.transfers, opts).split('\n')
    expect(gwl[0]).toMatch(/^A;SRC;;;1;;10;Water/)
    expect(gwl[1]).toMatch(/^D;DST;;;1;;10;Water/)
    expect(gwl[2]).toBe('W;')
    expect(writeWorklist('hamilton', plan.transfers, opts)).toContain('SourcePosition')
    const py = writeWorklist('opentrons', plan.transfers, { ...opts, title: 'My "run"' })
    expect(py).toContain('("A1", "A1", 10)')
    expect(py).toContain('apiLevel')
    expect(py).not.toContain('My "run"')
  })
})

describe('run log', () => {
  const plan = buildWorklist(dest, { ...base, mode: 'cherry_pick' })
  it('reconciles a log against the plan', () => {
    const log = parseRunLog(
      'Source Well,Destination Well,Actual Volume,Status\nA1,A1,10,ok\nA1,A2,3,ok\nB1,B1,10,failed\n',
    )
    expect(log.entries).toHaveLength(3)
    const r = reconcileRunLog(plan.transfers, log.entries)
    const by = (w: string) => r.find((t) => t.destWell === w)!
    expect(by('A1').status).toBe('done')
    expect(by('A2').status).toBe('short')
    expect(by('B1').status).toBe('failed')
    expect(by('B2').status).toBe('missing')
    expect(withdrawalsFrom(r)).toEqual([{ sampleId: 's1', label: 'S-1', totalUl: 13 }])
  })
  it('reads an Echo report in nL', () => {
    const log = parseRunLog('Source Well,Destination Well,Actual Volume\nA1,A1,2500', { volumeUnit: 'nl' })
    expect(log.entries[0].actualUl).toBe(2.5)
  })
  it('says when it cannot find the wells', () => {
    expect(parseRunLog('a,b\n1,2').warnings).toContain('no_well_columns')
  })
})
