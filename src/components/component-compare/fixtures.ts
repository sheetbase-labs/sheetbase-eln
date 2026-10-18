import type { ComparisonFixture, ComparisonRow } from './types'

/**
 * The fixed, hostile fixture set (ADR-0055 decision 5).
 *
 * Both columns of a pair render the same fixture *object* — a component that
 * copies or mutates one is caught by the identity assertion in
 * `component-compare.test.tsx` and by the deep freeze here. The axes are the
 * ones a component under comparison actually breaks on: no rows, one row, a
 * list long enough to expose layout and measurement assumptions, labels far
 * longer than any design comp shows, a column holding more than one type, a
 * column that is entirely null, and values that lose digits if they are
 * formatted carelessly.
 *
 * Fixtures are generated, not hand-listed row by row: 5,000 literal rows would
 * be unreadable and would drift. Generation is deterministic — the bulk
 * fixture uses a fixed seed — so a comparison is reproducible from the
 * repository alone.
 */

const KINDS: readonly ComparisonRow['kind'][] = [
  'Sample',
  'Control',
  'Standard',
]

/** Deterministic pseudo-random source: a seeded linear congruential generator. */
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

const LONG_NAME =
  '4-(2-Hydroxyethyl)-1-piperazineethanesulfonic acid, ≥99.5% (titration), ' +
  'cell-culture tested, endotoxin-free (≤0.1 EU/mg), lot 24K-1187/B'
const LONG_UNIT =
  'µmol L⁻¹ s⁻¹ per 10⁶ cells mL⁻¹ (normalised to total protein, mg mL⁻¹)'

function row(
  index: number,
  overrides: Partial<ComparisonRow> = {},
): ComparisonRow {
  return Object.freeze({
    id: `row-${String(index + 1).padStart(4, '0')}`,
    name: `Sample ${index + 1} · virus stock`,
    unit: 'mg mL⁻¹',
    value: Number(((index + 1) * 0.137).toFixed(3)),
    note: index % 3 === 0 ? `Replicate ${(index % 4) + 1}` : null,
    kind: KINDS[index % KINDS.length] ?? null,
    ...overrides,
  })
}

function rows(count: number): readonly ComparisonRow[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => row(index)))
}

/** 5,000 rows: enough to expose measurement, virtualisation and layout cost. */
function bulkRows(count: number): readonly ComparisonRow[] {
  const random = seeded(20261016)
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const value = random() * 1000
      return Object.freeze({
        id: `row-${String(index + 1).padStart(5, '0')}`,
        name: `S-${String(index + 1).padStart(4, '0')} · ${(random() * 1e6).toFixed(0)} TCID₅₀ mL⁻¹`,
        unit: index % 7 === 0 ? LONG_UNIT : 'mg mL⁻¹',
        value: Number(value.toFixed(6)),
        note: index % 11 === 0 ? null : `run ${(index % 96) + 1}`,
        kind: KINDS[index % KINDS.length] ?? null,
      })
    }),
  )
}

function fixture(
  id: string,
  hostility: string,
  description: string,
  fixtureRows: readonly ComparisonRow[],
): ComparisonFixture {
  return Object.freeze({ id, hostility, description, rows: fixtureRows })
}

export const COMPARISON_FIXTURES: readonly ComparisonFixture[] = Object.freeze([
  fixture(
    'empty',
    '0 rows',
    'No rows at all: the empty state, not an error.',
    rows(0),
  ),
  fixture(
    'single',
    '1 row',
    'One row: the boundary a list gets wrong.',
    rows(1),
  ),
  fixture(
    'bulk',
    '5,000 rows',
    'A long list: cost, measurement and scroll.',
    bulkRows(5000),
  ),
  fixture(
    'long-labels',
    'Very long names and units',
    'Scientific names and units far wider than any column.',
    Object.freeze([
      row(0, { name: LONG_NAME, unit: LONG_UNIT, value: 1.087 }),
      row(1, { name: LONG_NAME, unit: LONG_UNIT, value: 0 }),
      row(2, {
        name:
          'Recombinant human insulin-like growth factor 1 (IGF-1), carrier-free, ' +
          'expressed in E. coli, ≥98% (SDS-PAGE), 1 mg lyophilised',
        unit: LONG_UNIT,
        value: 1e-6,
      }),
      row(3, {
        name: 'Monoclonal anti-β-actin clone AC-15, ascites fluid',
        unit: 'µg mL⁻¹ (working dilution 1:10,000–1:50,000)',
        value: 0.5,
      }),
      ...rows(8).slice(4),
    ]),
  ),
  fixture(
    'mixed-types',
    'Mixed types in one column',
    'Numbers, numeric strings, dates, free text and nulls in one column.',
    Object.freeze([
      row(0, { value: 0.412 }),
      row(1, { value: '0.412' }),
      row(2, { value: '2026-10-16T09:14:00.000Z' }),
      row(3, { value: 'not determined (below LOQ)' }),
      row(4, { value: null }),
      row(5, { value: '1 234,5' }),
      row(6, { value: Number.NaN }),
      row(7, { value: Number.POSITIVE_INFINITY }),
    ]),
  ),
  fixture(
    'null-column',
    'A column that is entirely null',
    'Every row has a null note; one row has a null kind as well.',
    Object.freeze(
      rows(12).map((fixtureRow, index) =>
        Object.freeze({
          ...fixtureRow,
          note: null,
          kind: index === 4 ? null : fixtureRow.kind,
        }),
      ),
    ),
  ),
  fixture(
    'high-precision',
    'High-precision values',
    'Values whose digits are lost by a careless formatter.',
    Object.freeze([
      // Written as an expression, not a literal: a decimal literal long
      // enough to matter for this fixture is also long enough to be flagged
      // as precision-losing, and the value is exact in the double either way.
      row(0, { value: 1 / 3 }),
      row(8, { value: 0.1 * 3 }),
      row(1, { value: 6.02214076e23 }),
      row(2, { value: 1.602176634e-19 }),
      row(3, { value: 0.1 + 0.2 }),
      row(4, { value: 1234567.8901234567 }),
      // The largest double below 1, written as an expression so the
      // literal does not lose digits to the IEEE-754 rounding the
      // fixture exists to catch.
      row(5, { value: 1 - Number.EPSILON / 2 }),
      row(6, { value: 1e-21 }),
      row(7, { value: Number.EPSILON }),
    ]),
  ),
])

export function findFixture(id: string): ComparisonFixture {
  const found = COMPARISON_FIXTURES.find((entry) => entry.id === id)
  if (!found) throw new Error(`Unknown comparison fixture: ${id}`)
  return found
}
