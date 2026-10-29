/**
 * VIEW-03 — Compare surface component tests. The preview renders through
 * the existing chart renderer; these tests cover faceting controls bound to
 * explicit fields and the promote-to-ChartSpec hand-off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { CompareView } from './compare-view'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { validateChartSpec } from '#/lib/chart-spec'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'
import { COMPARATIVE_VIEW_CONFIG_VERSION } from '#/lib/comparative-view'
import type { ComparativeViewConfig } from '#/lib/comparative-view'
import type { DatasetValueFlag } from '#/lib/dataset-flags'
import { CHART_ROW_ID_KEY } from '#/lib/visualisation-pipeline'

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
})

const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const PH = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const BUFFER = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const COLUMNS: ChartColumn[] = [
  { id: TIME, label: 'Time (h)', logicalType: 'decimal' },
  { id: PH, label: 'pH', logicalType: 'decimal' },
  { id: BUFFER, label: 'Buffer', logicalType: 'category' },
]

const SOURCE: CanonicalDatasetSource = {
  datasetId: DATASET_ID,
  name: 'Stability',
  workspaceId: '00000000-0000-4000-8000-00000000ffff',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 1,
  revision: 1,
  columns: COLUMNS,
}

const ROWS: Record<string, unknown>[] = [
  { [TIME]: 0, [PH]: 7.0, [BUFFER]: 'A' },
  { [TIME]: 1, [PH]: 7.2, [BUFFER]: 'A' },
  { [TIME]: 0, [PH]: 6.8, [BUFFER]: 'B' },
  { [TIME]: 1, [PH]: null, [BUFFER]: 'B' },
]

function baseConfig(
  overrides: Partial<ComparativeViewConfig> = {},
): ComparativeViewConfig {
  return {
    configVersion: COMPARATIVE_VIEW_CONFIG_VERSION,
    datasetId: DATASET_ID,
    versionId: null,
    viewType: 'time_series',
    timeField: TIME,
    valueField: PH,
    groupBy: [BUFFER],
    facetBy: null,
    ...overrides,
  }
}

function renderCompare(
  initial: ComparativeViewConfig,
  flags: DatasetValueFlag[] = [],
) {
  const onPromote = vi.fn()
  function Harness() {
    const [config, setConfig] = useState(initial)
    return (
      <CompareView
        source={SOURCE}
        columns={COLUMNS}
        rows={ROWS}
        flags={flags}
        config={config}
        onConfigChange={setConfig}
        onPromote={onPromote}
      />
    )
  }
  render(<Harness />)
  return { onPromote }
}

describe('CompareView', () => {
  it('shows grouped series with statistics and honest null counts', () => {
    renderCompare(baseConfig())
    const table = screen.getByRole('table', { name: 'Compare group summary' })
    // Group rows surface by explicit field value.
    expect(within(table).getByText('A')).toBeDefined()
    expect(within(table).getByText('B')).toBeDefined()
    // The null pH in group B is counted, never averaged: the single value
    // fills min/mean/median/max alike.
    expect(within(table).getAllByText('6.8')).toHaveLength(4)
    expect(
      screen.getByText(/1 null values excluded from statistics/),
    ).toBeDefined()
  })

  it('binds faceting controls to explicit fields only', () => {
    renderCompare(baseConfig())
    const facet = screen.getByLabelText('Facet field')
    // The active groupBy field is never offered as a facet.
    const options = [...facet.querySelectorAll('option')].map(
      (o) => o.textContent,
    )
    expect(options).not.toContain('Buffer')
    expect(options).toContain('Time (h)')
    fireEvent.change(facet, { target: { value: TIME } })
    // Mixed facets report honestly instead of picking one.
    expect(screen.getAllByText('mixed').length).toBeGreaterThan(0)
  })

  it('promotes the configuration through the canonical ChartSpec path', () => {
    const { onPromote } = renderCompare(baseConfig())
    fireEvent.click(
      screen.getByRole('button', { name: 'Use in a chart or analysis' }),
    )
    expect(onPromote).toHaveBeenCalledTimes(1)
    const spec = onPromote.mock.calls[0][0] as ChartSpec
    expect(spec.type).toBe('line')
    expect(validateChartSpec(spec)).toEqual([])
  })

  it('promotes distribution views as box specs', () => {
    const { onPromote } = renderCompare(
      baseConfig({ viewType: 'distribution', timeField: null }),
    )
    // No time control for distributions; the promote path still holds.
    expect(screen.queryByLabelText('Time field')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Use in a chart or analysis' }),
    )
    const spec = onPromote.mock.calls[0][0] as ChartSpec
    expect(spec.type).toBe('box')
    expect(validateChartSpec(spec)).toEqual([])
  })

  it('withholds promote when the config leaves nothing to compare', () => {
    renderCompare(baseConfig({ groupBy: [] }))
    expect(screen.getByRole('alert').textContent).toMatch(/groupBy/)
    expect(
      screen.queryByRole('button', { name: 'Use in a chart or analysis' }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// R5-STUDIO-03 — A/B sides, swap and row matching
// ---------------------------------------------------------------------------

const AB_COLUMNS: ChartColumn[] = [
  { id: 'c-train', label: 'Train', logicalType: 'category' },
  { id: 'c-load', label: 'Load', logicalType: 'decimal' },
  { id: 'c-yield', label: 'Yield', logicalType: 'decimal' },
  { id: 'c-sample', label: 'Sample ID', logicalType: 'text' },
]

const AB_SOURCE: CanonicalDatasetSource = {
  datasetId: '00000000-0000-4000-8000-0000000000d1',
  name: 'Studio 03 compare dataset',
  workspaceId: '00000000-0000-4000-8000-0000000000d2',
  schemaVersionId: '00000000-0000-4000-8000-0000000000d3',
  schemaVersionNumber: 1,
  revision: 4,
  columns: AB_COLUMNS,
}

const AB_CONFIG: ComparativeViewConfig = {
  configVersion: COMPARATIVE_VIEW_CONFIG_VERSION,
  datasetId: AB_SOURCE.datasetId,
  versionId: null,
  viewType: 'time_series',
  timeField: 'c-load',
  valueField: 'c-yield',
  groupBy: ['c-train'],
  facetBy: null,
}

const AB_ROWS: Record<string, unknown>[] = [
  {
    [CHART_ROW_ID_KEY]: 'r1',
    'c-train': 'A',
    'c-load': 10,
    'c-yield': 80,
    'c-sample': 'S1',
  },
  {
    [CHART_ROW_ID_KEY]: 'r2',
    'c-train': 'A',
    'c-load': 20,
    'c-yield': 82,
    'c-sample': 'S2',
  },
  {
    [CHART_ROW_ID_KEY]: 'r1',
    'c-train': 'B',
    'c-load': 10,
    'c-yield': 79,
    'c-sample': 'S1',
  },
  {
    [CHART_ROW_ID_KEY]: 'r2',
    'c-train': 'B',
    'c-load': 20,
    'c-yield': 90,
    'c-sample': 'S2',
  },
  {
    [CHART_ROW_ID_KEY]: 'r9',
    'c-train': 'B',
    'c-load': 30,
    'c-yield': 91,
    'c-sample': 'S9',
  },
]

function renderAbCompare(rows: Record<string, unknown>[] = AB_ROWS) {
  render(
    <CompareView
      source={AB_SOURCE}
      columns={AB_COLUMNS}
      rows={rows}
      config={AB_CONFIG}
      onConfigChange={vi.fn()}
      onPromote={vi.fn()}
    />,
  )
}

/** The cells of the A/B row whose key cell reads `key`. */
function pairCells(key: string): string[] {
  const table = screen.getByRole('table', { name: 'A/B comparison' })
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByText(key) !== null)
  if (!row) throw new Error(`No paired row for ${key}`)
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

describe('CompareView A/B controls', () => {
  it('pairs the two default sides by dataset row key and states the rule', () => {
    renderAbCompare()

    // The rule the pairing uses is on screen, verbatim.
    expect(
      screen.getByText(/matched by the dataset row key/, {
        selector: '[data-compare-match-rule]',
      }),
    ).toBeTruthy()

    const headers = within(
      screen.getByRole('table', { name: 'A/B comparison' }),
    ).getAllByRole('columnheader')
    expect(headers[1].textContent).toContain('A · A')
    expect(headers[2].textContent).toContain('B · B')

    // r2 is present on both sides: A 82, B 90, Δ +8.
    expect(pairCells('r2').slice(1, 4)).toEqual(['82', '90', '+8'])
    // r9 exists only on side B and is reported as unmatched, never dropped.
    expect(pairCells('r9')[4]).toContain('B only')

    const summary = screen.getByText(/rows matched/)
    expect(summary.textContent).toContain('2 rows matched')
    expect(summary.textContent).toContain('1 unmatched')
  })

  it('swaps the sides, flipping the column labels and the Δ sign', () => {
    renderAbCompare()

    fireEvent.click(screen.getByRole('button', { name: 'Swap A/B' }))

    const headers = within(
      screen.getByRole('table', { name: 'A/B comparison' }),
    ).getAllByRole('columnheader')
    expect(headers[1].textContent).toContain('A · B')
    expect(headers[2].textContent).toContain('B · A')

    // The same pair, read the other way round: A 90, B 82, Δ −8.
    expect(pairCells('r2').slice(1, 4)).toEqual(['90', '82', '-8'])
    expect(pairCells('r9')[4]).toContain('A only')
  })

  it('re-pairs and re-states the rule when "match rows by" changes', () => {
    renderAbCompare()

    // Field matching re-keys the rows on the chosen field value.
    fireEvent.change(screen.getByLabelText('Match rows by'), {
      target: { value: 'field' },
    })
    fireEvent.change(screen.getByLabelText('Match field'), {
      target: { value: 'c-sample' },
    })
    expect(
      screen.getByText(/matched by the value of Sample ID/, {
        selector: '[data-compare-match-rule]',
      }),
    ).toBeTruthy()
    expect(pairCells('S2').slice(1, 4)).toEqual(['82', '90', '+8'])

    // Position matching re-keys on the run order within each side and says so.
    fireEvent.change(screen.getByLabelText('Match rows by'), {
      target: { value: 'position' },
    })
    expect(
      screen.getByText(/matched by their position in the run order/, {
        selector: '[data-compare-match-rule]',
      }),
    ).toBeTruthy()
    // The first row of each side pairs: A 80 against B 79.
    expect(pairCells('#1').slice(1, 4)).toEqual(['80', '79', '-1'])
  })

  it('states that two groups are needed before it can pair anything', () => {
    renderAbCompare(AB_ROWS.filter((row) => row['c-train'] === 'A'))

    expect(
      screen.getByText(
        'At least two groups are needed to compare A against B.',
      ),
    ).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// DSET-01.2 flag exclusion and the interactive preview's selection
// ---------------------------------------------------------------------------

describe('CompareView flag exclusion and selection', () => {
  const FLAGGED_ROWS: Record<string, unknown>[] = [
    { [CHART_ROW_ID_KEY]: 'r1', [TIME]: 0, [PH]: 7.0, [BUFFER]: 'A' },
    { [CHART_ROW_ID_KEY]: 'r2', [TIME]: 1, [PH]: 7.2, [BUFFER]: 'A' },
    { [CHART_ROW_ID_KEY]: 'r3', [TIME]: 0, [PH]: 6.8, [BUFFER]: 'B' },
    { [CHART_ROW_ID_KEY]: 'r4', [TIME]: 1, [PH]: 7.1, [BUFFER]: 'B' },
  ]

  function renderFlagged(flags: DatasetValueFlag[]) {
    render(
      <CompareView
        source={SOURCE}
        columns={COLUMNS}
        rows={FLAGGED_ROWS}
        flags={flags}
        config={baseConfig()}
        onConfigChange={() => {}}
        onPromote={() => {}}
      />,
    )
  }

  it('leaves out a row whose used value is flagged', () => {
    renderFlagged([
      {
        id: 'flag-1',
        datasetId: DATASET_ID,
        rowId: 'r2',
        fieldId: PH,
        kind: 'out_of_range',
        reason: 'Above the stability window',
        comment: null,
        setAt: '2026-01-01T00:00:00Z',
      },
    ])

    expect(screen.getByText(/rows · 2 groups/).textContent).toContain('3 rows')
    // The flagged 7.2 is gone from the group statistics.
    const table = screen.getByRole('table', { name: 'Compare group summary' })
    expect(within(table).queryByText('7.2')).toBeNull()
  })

  it('shows the point the interactive preview reports', () => {
    renderCompare(baseConfig())
    expect(screen.queryByText(/^Selected /)).toBeNull()

    const hit = document.querySelector('circle[r="9"]')
    expect(hit).toBeTruthy()
    fireEvent.click(hit as Element)

    const summary = screen.getByText(/^Selected /)
    expect(summary.textContent).toContain('x 0')
    expect(summary.textContent).toContain('y 7')
  })
})
