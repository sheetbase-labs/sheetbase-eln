/**
 * Analysis Studio: comparison (t-tests, Mann–Whitney, ANOVA with pairwise
 * comparisons) and survival, run through the same entry point as every other
 * statistic.
 */
import { describe, expect, it } from 'vitest'

import {
  analysisMethodsText,
  runAnalysis,
  validateAnalysisDefinition,
} from './analysis-definition'
import type {
  ComparisonDefinition,
  ComparisonResult,
  SurvivalDefinition,
  SurvivalResult,
} from './analysis-definition'
import type { ChartColumn } from './chart-spec'

const DATASET = '0198d970-e266-4000-8000-000000000001'
const V = '0198d970-e266-4000-8000-000000000002'
const G = '0198d970-e266-4000-8000-000000000003'
const S = '0198d970-e266-4000-8000-000000000004'
const T = '0198d970-e266-4000-8000-000000000005'
const E = '0198d970-e266-4000-8000-000000000006'

const COLUMNS: ChartColumn[] = [
  { id: V, label: 'Value', logicalType: 'decimal' },
  { id: G, label: 'Group', logicalType: 'text' },
  { id: S, label: 'Subject', logicalType: 'text' },
  { id: T, label: 'Time', logicalType: 'decimal' },
  { id: E, label: 'Event', logicalType: 'integer' },
]

const base = {
  definitionVersion: 1 as const,
  datasets: [{ datasetId: DATASET }],
}

function rowsOf(groups: Record<string, number[]>) {
  const out: Record<string, unknown>[] = []
  for (const [g, values] of Object.entries(groups))
    values.forEach((v, i) => out.push({ [V]: v, [G]: g, [S]: `s${i + 1}` }))
  return out
}

const comparison = (
  patch: Partial<ComparisonDefinition> = {},
): ComparisonDefinition => ({
  ...base,
  kind: 'comparison',
  value: { fieldId: V },
  group: { fieldId: G },
  ...patch,
})

function compare(
  definition: ComparisonDefinition,
  groups: Record<string, number[]>,
): ComparisonResult {
  const out = runAnalysis(definition, COLUMNS, rowsOf(groups))
  if (!out.ok || out.result.kind !== 'comparison')
    throw new Error(`unexpected: ${JSON.stringify(out)}`)
  return out.result
}

describe('comparison', () => {
  const two = { a: [1, 2, 3, 4, 5], b: [3, 4, 5, 6, 7] }

  it('runs Welch’s t-test by default', () => {
    const r = compare(comparison(), two)
    expect(r.method.id).toBe('two_group_t_test')
    expect(r.pairs).toHaveLength(1)
    const p = r.pairs[0]
    expect(p.difference).toBeCloseTo(-2, 10)
    expect(p.statistic).toBeCloseTo(-2, 10)
    expect(p.df).toBeCloseTo(8, 6)
    expect(p.p).toBeCloseTo(0.0805, 3)
    expect(p.significant).toBe(false)
    expect(p.ci95!.lo).toBeLessThan(-2)
    expect(p.ci95!.hi).toBeGreaterThan(-2)
  })

  it('pools the variance for Student’s t-test', () => {
    const r = compare(comparison({ test: 'student' }), two)
    expect(r.pairs[0].df).toBe(8)
    expect(r.method.label).toMatch(/Student/)
  })

  it('pairs by subject and ignores a subject with only one value', () => {
    const rows = [
      ...[10, 12, 14, 11].map((v, i) => ({ [V]: v, [G]: 'pre', [S]: `s${i}` })),
      ...[12, 15, 15, 14].map((v, i) => ({
        [V]: v,
        [G]: 'post',
        [S]: `s${i}`,
      })),
      { [V]: 99, [G]: 'post', [S]: 'orphan' },
    ]
    const out = runAnalysis(
      comparison({ test: 'paired', pair: { fieldId: S } }),
      COLUMNS,
      rows,
    )
    if (!out.ok || out.result.kind !== 'comparison') throw new Error('failed')
    expect(out.result.pairedSubjects).toBe(4)
    // post − pre per subject: 2, 3, 1, 3 → mean 2.25 (groups sort post, pre).
    expect(out.result.pairs[0].difference).toBeCloseTo(2.25, 10)
    expect(out.result.pairs[0].effectLabel).toBe('cohens_d')
  })

  it('needs a subject column for the paired test', () => {
    expect(
      validateAnalysisDefinition(comparison({ test: 'paired' })).map(
        (e) => e.field,
      ),
    ).toContain('pair')
    const out = runAnalysis(
      comparison({ test: 'paired' }),
      COLUMNS,
      rowsOf(two),
    )
    expect(out).toEqual({
      ok: false,
      error: { code: 'missing_field', fields: ['pair'] },
    })
  })

  it('runs Mann–Whitney with an exact p when there are no ties', () => {
    const r = compare(comparison({ test: 'mann_whitney' }), {
      a: [1, 2, 3, 4, 5],
      b: [6, 7, 8, 9, 10],
    })
    expect(r.pMethod).toBe('exact')
    expect(r.pairs[0].statisticLabel).toBe('U')
    expect(r.pairs[0].p).toBeCloseTo(2 / 252, 6)
    expect(r.pairs[0].effectLabel).toBe('rank_biserial')
  })

  it('refuses a two-group test on three groups, and says so', () => {
    const out = runAnalysis(
      comparison(),
      COLUMNS,
      rowsOf({ a: [1, 2, 3], b: [2, 3, 4], c: [3, 4, 5] }),
    )
    expect(out).toEqual({
      ok: false,
      error: { code: 'needs_groups', needed: 2, found: 3 },
    })
  })

  const three = {
    control: [10, 11, 9, 10, 12],
    low: [11, 12, 10, 11, 13],
    high: [16, 17, 15, 16, 18],
  }

  it('follows ANOVA with Tukey comparisons of every pair', () => {
    const r = compare(comparison({ test: 'anova' }), three)
    expect(r.method.id).toBe('anova_post_hoc')
    expect(r.omnibus!.p).toBeLessThan(0.001)
    expect(r.postHoc).toBe('tukey')
    expect(r.pairs).toHaveLength(3)
    const high = r.pairs.filter(
      (p) => p.group1 === 'high' || p.group2 === 'high',
    )
    expect(high.every((p) => p.significant)).toBe(true)
    const lowVsControl = r.pairs.find(
      (p) =>
        [p.group1, p.group2].includes('low') &&
        [p.group1, p.group2].includes('control'),
    )!
    expect(lowVsControl.significant).toBe(false)
    expect(lowVsControl.adjusted).toBe(true)
  })

  it('compares each group with the control for Dunnett', () => {
    const r = compare(
      comparison({ test: 'anova', postHoc: 'dunnett', control: 'control' }),
      three,
    )
    expect(r.control).toBe('control')
    expect(r.pairs).toHaveLength(2)
    expect(r.pairs.every((p) => p.group2 === 'control')).toBe(true)
  })

  it('rejects a Dunnett control that is not a group', () => {
    const out = runAnalysis(
      comparison({ test: 'anova', postHoc: 'dunnett', control: 'nope' }),
      COLUMNS,
      rowsOf(three),
    )
    expect(out).toEqual({
      ok: false,
      error: { code: 'unknown_control', control: 'nope' },
    })
  })

  it('is deterministic and reports the method in the methods text', () => {
    const a = compare(comparison({ test: 'anova' }), three)
    const b = compare(comparison({ test: 'anova' }), three)
    expect(a).toEqual(b)
    const text = analysisMethodsText(a)
    expect(text).toMatch(/ANOVA/)
    expect(text).toMatch(/high vs control|control vs high/)
  })

  it('validates the new fields', () => {
    expect(validateAnalysisDefinition(comparison())).toEqual([])
    const bad = validateAnalysisDefinition({
      ...comparison(),
      test: 'sign',
      postHoc: 'scheffe',
      alpha: 2,
    })
    expect(bad.map((e) => e.field).sort()).toEqual(['alpha', 'postHoc', 'test'])
  })
})

describe('survival', () => {
  const survival = (
    patch: Partial<SurvivalDefinition> = {},
  ): SurvivalDefinition => ({
    ...base,
    kind: 'survival',
    time: { fieldId: T },
    event: { fieldId: E },
    group: { fieldId: G },
    ...patch,
  })

  // Freireich 6-MP trial (Kaplan–Meier/log-rank reference data).
  const drug = [6, 6, 6, 7, 10, 13, 16, 22, 23]
  const drugEvent = [1, 1, 1, 1, 1, 1, 1, 1, 1]
  const drugCensored = [6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35]
  const control = [
    1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23,
  ]

  const rows = [
    ...drug.map((t, i) => ({ [T]: t, [E]: drugEvent[i], [G]: '6-MP' })),
    ...drugCensored.map((t, i) => ({
      [T]: t,
      [E]: i < 1 ? 1 : 0,
      [G]: '6-MP',
    })),
    ...control.map((t) => ({ [T]: t, [E]: 1, [G]: 'Control' })),
  ]

  it('draws a Kaplan–Meier curve for each group and tests them', () => {
    const out = runAnalysis(survival(), COLUMNS, rows)
    if (!out.ok || out.result.kind !== 'survival') throw new Error('failed')
    const r: SurvivalResult = out.result
    expect(r.method.id).toBe('kaplan_meier')
    expect(r.curves.map((c) => c.group)).toEqual(['6-MP', 'Control'])
    expect(r.curves[1].n).toBe(21)
    expect(r.curves[1].medianSurvival).toBe(8)
    expect(r.logRank!.df).toBe(1)
    expect(r.logRank!.p).toBeLessThan(0.001)
    expect(r.maxTime).toBe(35)
  })

  it('leaves out a row whose time or event is missing and says how many', () => {
    const out = runAnalysis(survival(), COLUMNS, [
      ...rows,
      { [T]: 5, [E]: 'maybe', [G]: 'Control' },
      { [T]: null, [E]: 1, [G]: 'Control' },
    ])
    if (!out.ok || out.result.kind !== 'survival') throw new Error('failed')
    expect(out.result.curves[1].missing).toBe(2)
    expect(out.result.curves[1].n).toBe(21)
  })

  it('reads yes/no and true/false as events', () => {
    const out = runAnalysis(survival({ group: null }), COLUMNS, [
      { [T]: 1, [E]: 'yes' },
      { [T]: 2, [E]: 'no' },
      { [T]: 3, [E]: true },
    ])
    if (!out.ok || out.result.kind !== 'survival') throw new Error('failed')
    expect(out.result.curves[0].events).toBe(2)
    expect(out.result.curves[0].censored).toBe(1)
    expect(out.result.logRank).toBeNull()
  })

  it('warns when a group never has the event', () => {
    const out = runAnalysis(survival(), COLUMNS, [
      { [T]: 1, [E]: 1, [G]: 'a' },
      { [T]: 2, [E]: 1, [G]: 'a' },
      { [T]: 3, [E]: 0, [G]: 'b' },
      { [T]: 4, [E]: 0, [G]: 'b' },
    ])
    if (!out.ok || out.result.kind !== 'survival') throw new Error('failed')
    const check = out.result.checks.find((c) => c.id === 'events_observed')
    expect(check?.status).toBe('warn')
    expect(analysisMethodsText(out.result)).toMatch(/Log-rank/)
  })

  it('validates required bindings', () => {
    expect(validateAnalysisDefinition(survival())).toEqual([])
    const bad = validateAnalysisDefinition({ ...survival(), time: undefined })
    expect(bad[0].field).toBe('time')
  })
})
