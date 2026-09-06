/**
 * VIEW-03 — Compare surface component tests. The preview renders through
 * the existing chart renderer; these tests cover faceting controls bound to
 * explicit fields and the promote-to-ChartSpec hand-off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CompareView } from './compare-view'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { validateChartSpec } from '#/lib/chart-spec'
import type { ChartColumn, ChartSpec } from '#/lib/chart-spec'
import {
  COMPARATIVE_VIEW_CONFIG_VERSION,
} from '#/lib/comparative-view'
import type { ComparativeViewConfig } from '#/lib/comparative-view'

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

function renderCompare(initial: ComparativeViewConfig) {
  const onPromote = vi.fn()
  function Harness() {
    const [config, setConfig] = useState(initial)
    return (
      <CompareView
        source={SOURCE}
        columns={COLUMNS}
        rows={ROWS}
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
    const facet = screen.getByLabelText('Facet field') as HTMLSelectElement
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
      screen.getByRole('button', { name: 'Promote to chart/analysis' }),
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
      screen.getByRole('button', { name: 'Promote to chart/analysis' }),
    )
    const spec = onPromote.mock.calls[0][0] as ChartSpec
    expect(spec.type).toBe('box')
    expect(validateChartSpec(spec)).toEqual([])
  })

  it('withholds promote when the config leaves nothing to compare', () => {
    renderCompare(baseConfig({ groupBy: [] }))
    expect(screen.getByRole('alert').textContent).toMatch(/groupBy/)
    expect(
      screen.queryByRole('button', { name: 'Promote to chart/analysis' }),
    ).toBeNull()
  })
})
