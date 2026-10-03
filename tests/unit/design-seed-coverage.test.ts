/**
 * DSYS-05.4 — the design-seed coverage gate's classification logic. The
 * script's database scan is covered by `pnpm design:coverage`; here we prove
 * the pure summary used to decide pass/fail, including the deliberate-miss
 * cases the gate must reject.
 */
import { describe, expect, it } from 'vitest'

import {
  parseListArg,
  summarizeCoverage,
  type ScreenText,
} from '../../scripts/design-seed-coverage.mts'

const screens: ScreenText[] = [
  { name: 'Notebook.txt', text: 'EXP-0138 links DS-0311 and SHT-0019' },
  { name: 'PipelineRuns.txt', text: 'PL-0007 run #148' },
]

describe('design-seed coverage summary', () => {
  it('counts stored-family tokens and records the misses per screen', () => {
    const summary = summarizeCoverage(
      screens,
      ['EXP-0138', 'PL-0007'],
      ['EXP', 'PL', 'DS'],
      [],
    )
    expect(summary.total).toBe(3) // EXP, DS, PL (SHT is display-only)
    expect(summary.unmatched).toBe(1)
    expect(summary.unmatchedByScreen).toEqual([
      { screen: 'Notebook', tokens: ['DS-0311'] },
    ])
  })

  it('treats seeded values as matched', () => {
    const summary = summarizeCoverage(
      [{ name: 'Samples.txt', text: 'SMP-2248' }],
      ['SMP-2248'],
      ['SMP'],
      ['SMP-2248'],
    )
    expect(summary.unmatched).toBe(0)
    expect(summary.missingValues).toEqual([])
  })

  it('reports display-id families separately from seed misses', () => {
    const summary = summarizeCoverage(
      [{ name: 'SheetWorking.txt', text: 'SHT-0019 SIG-8903 DS-0311' }],
      ['DS-0311'],
      ['DS'],
      [],
    )
    expect(summary.displayFamilies).toEqual(['SHT', 'SIG'])
    expect(summary.total).toBe(1)
    expect(summary.unmatched).toBe(0)
  })

  it('fails when a required family has no seeded value', () => {
    const summary = summarizeCoverage(screens, ['EXP-0138'], ['EXP', 'PL'], [])
    expect(summary.missingFamilies).toEqual(['PL'])
  })

  it('fails when a required value is absent', () => {
    const summary = summarizeCoverage(
      screens,
      ['EXP-0138', 'PL-0007'],
      ['EXP', 'PL'],
      ['DS-0311'],
    )
    expect(summary.missingValues).toEqual(['DS-0311'])
  })

  it('parses comma- and space-separated --require/--expect arguments', () => {
    expect(
      parseListArg(['--require=EXP,PL', '--expect', 'DS-0311'], 'require'),
    ).toEqual(['EXP', 'PL'])
    expect(
      parseListArg(
        ['--require=EXP,PL', '--expect', 'DS-0311,SHT-0019'],
        'expect',
      ),
    ).toEqual(['DS-0311', 'SHT-0019'])
  })
})
