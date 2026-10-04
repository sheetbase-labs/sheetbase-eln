/**
 * DSYS-05.4 — the design-seed coverage gate's classification logic. The
 * script's database scan is covered by `pnpm design:coverage`; here we prove
 * the pure summary used to decide pass/fail, including the deliberate-miss
 * cases the gate must reject.
 */
import { describe, expect, it } from 'vitest'

import {
  coverageExitCode,
  parseListArg,
  summarizeCoverage,
} from '../../scripts/design-seed-coverage.mts'
import type { ScreenText } from '../../scripts/design-seed-coverage.mts'

const screens: ScreenText[] = [
  { name: 'Notebook.txt', text: 'EXP-0138 links DS-0311 and SHT-0019' },
  { name: 'PipelineRuns.txt', text: 'PL-0007 run #148' },
]

describe('design-seed coverage summary', () => {
  it('counts every identifier family and records the misses per screen', () => {
    const summary = summarizeCoverage(
      screens,
      ['EXP-0138', 'PL-0007'],
      ['EXP', 'PL', 'DS'],
      [],
    )
    expect(summary.total).toBe(4)
    expect(summary.unmatched).toBe(2)
    expect(summary.unmatchedByScreen).toEqual([
      { screen: 'Notebook', tokens: ['DS-0311', 'SHT-0019'] },
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
    expect(coverageExitCode(summary)).toBe(0)
  })

  it('fails exactly one deliberately missing screen identifier and preserves report-only mode', () => {
    const summary = summarizeCoverage(
      [{ name: 'DeliberateMiss.txt', text: 'EXP-0138 SIG-9999' }],
      ['EXP-0138'],
      ['EXP'],
      ['EXP-0138'],
    )
    expect(summary.unmatched).toBe(1)
    expect(summary.missingFamilies).toEqual([])
    expect(summary.missingValues).toEqual([])
    expect(coverageExitCode(summary)).toBe(1)
    expect(coverageExitCode(summary, true)).toBe(0)
  })

  it('reports unknown authorities without excluding their values from misses', () => {
    const summary = summarizeCoverage(
      [{ name: 'SheetWorking.txt', text: 'SHT-0019 SIG-8903 DS-0311' }],
      ['DS-0311'],
      ['DS'],
      [],
    )
    expect(summary.displayFamilies).toEqual(['SIG'])
    expect(summary.total).toBe(3)
    expect(summary.unmatched).toBe(2)
    expect(summary.unmatchedByScreen).toEqual([
      { screen: 'SheetWorking', tokens: ['SHT-0019', 'SIG-8903'] },
    ])
  })

  it('does not accept a cited identifier or a longer identifier as its authority', () => {
    const summary = summarizeCoverage(
      [{ name: 'Notebook.txt', text: 'DS-0311' }],
      ['Copied from DS-0311', 'DS-03110'],
      [],
      ['DS-0311'],
    )
    expect(summary.unmatched).toBe(1)
    expect(summary.missingValues).toEqual(['DS-0311'])
  })

  it('does not accept an unknown family from a scanned identity column', () => {
    const summary = summarizeCoverage(
      [{ name: 'Signed.txt', text: 'SIG-9999' }],
      ['SIG-9999'],
      [],
      [],
    )
    expect(summary.unmatched).toBe(1)
    expect(coverageExitCode(summary)).toBe(1)
  })

  it('excludes only fixed copy and deduplicates within each screen', () => {
    const summary = summarizeCoverage(
      [{ name: 'Notebook.txt', text: 'SHA-256 DS-0311 DS-0311 SIG-8903' }],
      ['DS-0311'],
      [],
      [],
    )
    expect(summary.total).toBe(2)
    expect(summary.unmatchedByScreen).toEqual([
      { screen: 'Notebook', tokens: ['SIG-8903'] },
    ])
  })

  it('counts snapshot labels and condition keys rather than silently excluding them', () => {
    const summary = summarizeCoverage(
      [
        {
          name: 'DatasetCompare.txt',
          text: 'DS-0311 S-1 S-15 C-150 AMB-25-118',
        },
      ],
      ['DS-0311'],
      [],
      [],
    )
    expect(summary.total).toBe(5)
    expect(summary.unmatched).toBe(4)
    expect(summary.unmatchedByScreen).toEqual([
      {
        screen: 'DatasetCompare',
        tokens: ['S-1', 'S-15', 'C-150', 'AMB-25-118'],
      },
    ])
  })

  it('fails when a required family has no seeded value', () => {
    const summary = summarizeCoverage([], ['EXP-0138'], ['EXP', 'PL'], [])
    expect(summary.missingFamilies).toEqual(['PL'])
    expect(coverageExitCode(summary)).toBe(1)
  })

  it('fails when a required value is absent', () => {
    const summary = summarizeCoverage(
      [],
      ['EXP-0138', 'PL-0007'],
      ['EXP', 'PL'],
      ['DS-0311'],
    )
    expect(summary.missingValues).toEqual(['DS-0311'])
    expect(coverageExitCode(summary)).toBe(1)
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
