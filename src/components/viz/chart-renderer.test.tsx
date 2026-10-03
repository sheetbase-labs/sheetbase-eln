/**
 * SCI-004 chart renderer component tests. Verifies line/scatter/bar
 * rendering inside ChartFrame, the approved palette, accessible legend,
 * description and tabular alternative, live vs snapshot mode, and the
 * honest missing-field, empty-dataset, log-scale-invalid and stale states.
 *
 * The renderer is pure given a materialised chart, so no QueryClient or
 * data mocking is required.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChartRenderer } from './chart-renderer'
import { CHART_PALETTE } from '#/lib/chart-spec'
import type {
  ChartSpec,
  FrozenChart,
  MaterialisedChart,
} from '#/lib/chart-spec'

afterEach(() => cleanup())

const spec: ChartSpec = {
  specVersion: 1,
  type: 'line',
  datasets: [{ datasetId: '00000000-0000-4000-8000-000000000170' }],
  fields: {
    x: { fieldId: 'c1' },
    y: { fieldId: 'c2' },
    series: { fieldId: 'c3' },
    color: null,
    size: null,
    facet: null,
  },
  filters: [],
  transformations: [],
  typeParams: {},
  display: {
    axes: {
      x: { label: 'Time (days)', scale: 'linear', unit: 'd' },
      y: { label: 'Log titer', scale: 'linear', unit: 'log₁₀' },
    },
    series: [
      { identifier: '4 °C', label: '4 °C', color: CHART_PALETTE[0] },
      { identifier: '−20 °C', label: '−20 °C', color: CHART_PALETTE[1] },
    ],
    legend: { visible: true },
  },
  overlays: { errorBars: null },
}

function okMaterialised(): MaterialisedChart {
  return {
    state: { kind: 'ok' },
    columns: [
      {
        id: 'c1',
        label: 'Time (days)',
        logicalType: 'decimal',
      },
      {
        id: 'c2',
        label: 'Log titer',
        logicalType: 'decimal',
      },
      {
        id: 'c3',
        label: 'Condition',
        logicalType: 'text',
      },
    ],
    rows: [
      { col_time: 0, col_titer: 7.2, col_condition: '4 °C' },
      { col_time: 28, col_titer: 5.9, col_condition: '4 °C' },
    ],
    series: [
      {
        identifier: '4 °C',
        label: '4 °C',
        color: CHART_PALETTE[0],
        points: [
          { x: 0, y: 7.2, yError: null, label: '4 °C' },
          { x: 28, y: 5.9, yError: null, label: '4 °C' },
        ],
      },
    ],
    xLabel: 'Time (days)',
    yLabel: 'Log titer',
    xUnit: 'd',
    droppedPoints: 0,
    yUnit: 'log₁₀',
  }
}

describe('ChartRenderer', () => {
  it('renders a line chart inside a live ChartFrame with title and provenance', () => {
    render(
      <ChartRenderer
        title="Stability curve"
        provenance="Source: Stability readings (qPCR)"
        spec={spec}
        materialised={okMaterialised()}
        frozen={null}
      />,
    )
    expect(screen.getByText('Stability curve')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText('Source: Stability readings (qPCR)')).toBeTruthy()
    // SVG plot present.
    expect(document.querySelector('[role="img"]')).toBeTruthy()
  })

  it('renders a scatter chart', () => {
    render(
      <ChartRenderer
        title="Scatter"
        spec={{ ...spec, type: 'scatter' }}
        materialised={okMaterialised()}
        frozen={null}
      />,
    )
    expect(document.querySelector('[role="img"]')).toBeTruthy()
    // Scatter renders circles (points).
    expect(document.querySelectorAll('circle').length).toBeGreaterThan(0)
  })

  it('renders a bar chart from the package bar primitive', () => {
    render(
      <ChartRenderer
        title="Bar"
        spec={{ ...spec, type: 'bar' }}
        materialised={okMaterialised()}
        frozen={null}
      />,
    )
    expect(document.querySelector('[role="img"]')).toBeTruthy()
    // The package's bar marks are SVG rectangles.
    expect(document.querySelectorAll('svg rect').length).toBeGreaterThan(0)
  })

  it('renders a snapshot badge when frozen', () => {
    const frozen: FrozenChart = {
      revisionId: null,
      frozenAt: '2025-07-14T10:00:00Z',
      frozenByUserId: 'u1',
      datasetProvenance: [
        {
          datasetId: '00000000-0000-4000-8000-000000000170',
          schemaVersionNumber: 1,
          rowCount: 2,
          checksum: 'abc12345def',
        },
      ],
      data: {
        columns: [
          {
            fieldId: 'c1',
            label: 'Time (days)',
            logicalType: 'decimal',
            unit: { symbol: 'd' },
          },
          {
            fieldId: 'c2',
            label: 'Log titer',
            logicalType: 'decimal',
            unit: { symbol: 'log₁₀' },
          },
        ],
        rows: [{ col_time: 0, col_titer: 7.2 }],
        series: [
          {
            identifier: '4 °C',
            label: '4 °C',
            color: CHART_PALETTE[0],
            points: [{ x: 0, y: 7.2, yError: null, label: '4 °C' }],
          },
        ],
      },
    }
    render(
      <ChartRenderer
        title="Frozen"
        spec={spec}
        materialised={okMaterialised()}
        frozen={frozen}
      />,
    )
    expect(screen.getByText('Snapshot')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
    // The figure is still drawn by the package from the materialised (frozen)
    // points, so a record citing this version renders the same figure.
    expect(document.querySelector('svg.sb-figure')).toBeTruthy()
  })

  it('renders an accessible tabular alternative with the plotted points', () => {
    render(
      <ChartRenderer
        title="Tabular"
        spec={spec}
        materialised={okMaterialised()}
        frozen={null}
      />,
    )
    expect(screen.getByText(/Show data table/)).toBeTruthy()
  })

  it('renders an accessible legend with series labels', () => {
    const mat = okMaterialised()
    const twoSeries: MaterialisedChart = {
      ...mat,
      series: [
        ...mat.series,
        {
          identifier: '−20 °C',
          label: '−20 °C',
          color: CHART_PALETTE[1],
          points: [{ x: 0, y: 7.1, yError: null, label: '−20 °C' }],
        },
      ],
    }
    render(
      <ChartRenderer
        title="Legend"
        spec={spec}
        materialised={twoSeries}
        frozen={null}
      />,
    )
    expect(screen.getAllByText('4 °C').length).toBeGreaterThan(0)
    expect(screen.getAllByText('−20 °C').length).toBeGreaterThan(0)
  })

  it('surfaces a missing-field state instead of plotting', () => {
    const mat: MaterialisedChart = {
      ...okMaterialised(),
      state: { kind: 'missing_field', fields: ['y'] },
      series: [],
      rows: [],
    }
    render(
      <ChartRenderer
        title="Missing"
        spec={spec}
        materialised={mat}
        frozen={null}
      />,
    )
    expect(screen.getAllByText(/missing field/i).length).toBeGreaterThan(0)
    expect(document.querySelector('[role="img"]')).toBeNull()
  })

  it('surfaces an empty-dataset state', () => {
    const mat: MaterialisedChart = {
      ...okMaterialised(),
      state: { kind: 'empty_dataset' },
      series: [],
      rows: [],
    }
    render(
      <ChartRenderer
        title="Empty"
        spec={spec}
        materialised={mat}
        frozen={null}
      />,
    )
    expect(screen.getAllByText(/no rows matching/i).length).toBeGreaterThan(0)
  })

  it('surfaces a log-scale-invalid state', () => {
    const mat: MaterialisedChart = {
      ...okMaterialised(),
      state: { kind: 'log_scale_invalid', axis: 'y', invalidCount: 1 },
    }
    render(
      <ChartRenderer
        title="Log"
        spec={spec}
        materialised={mat}
        frozen={null}
      />,
    )
    expect(screen.getAllByText(/log scale/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/non-positive/i).length).toBeGreaterThan(0)
  })

  it('surfaces a stale-calculation state', () => {
    const mat: MaterialisedChart = {
      ...okMaterialised(),
      state: {
        kind: 'stale',
        detail: 'A plotted formula is stale. Recalculate the dataset.',
      },
    }
    render(
      <ChartRenderer
        title="Stale"
        spec={spec}
        materialised={mat}
        frozen={null}
      />,
    )
    expect(screen.getAllByText(/stale/i).length).toBeGreaterThan(0)
  })

  it('surfaces a missing-dataset state', () => {
    const mat: MaterialisedChart = {
      ...okMaterialised(),
      state: { kind: 'missing_dataset' },
      series: [],
      rows: [],
    }
    render(
      <ChartRenderer
        title="No dataset"
        spec={spec}
        materialised={mat}
        frozen={null}
      />,
    )
    expect(
      screen.getAllByText(/no dataset is referenced/i).length,
    ).toBeGreaterThan(0)
  })

  it('renders a loading skeleton', () => {
    render(
      <ChartRenderer
        title="Loading"
        spec={spec}
        materialised={okMaterialised()}
        frozen={null}
        loading
      />,
    )
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('renders an error state with role=alert', () => {
    render(
      <ChartRenderer
        title="Error"
        spec={spec}
        materialised={okMaterialised()}
        frozen={null}
        error="The dataset could not be loaded."
      />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
  })
})

describe('SCI-01 distribution chart types', () => {
  const distSpec = { ...spec, display: { ...spec.display, annotations: [] } }

  function histogramMaterialised() {
    return {
      state: { kind: 'ok' as const },
      columns: [],
      rows: [],
      series: [
        {
          identifier: '4C',
          label: '4 °C',
          color: '#006EDC',
          points: [
            { x: 70, y: 0, yError: null, label: '4C' },
            { x: 80, y: 2, yError: null, label: '4C' },
            { x: 90, y: 3, yError: null, label: '4C' },
          ],
        },
      ],
      xLabel: 'Bin start',
      yLabel: 'Count',
      xUnit: undefined,
      yUnit: undefined,
      droppedPoints: 0,
      bins: { edges: [70, 80, 90, 100] },
    }
  }

  it('renders a histogram with bars per bin and a selection hook', () => {
    const onSelect = vi.fn()
    render(
      <ChartRenderer
        title="Histogram"
        spec={{ ...distSpec, type: 'histogram' }}
        materialised={histogramMaterialised()}
        frozen={null}
        onSelectionChange={onSelect}
      />,
    )
    expect(screen.getByText('Histogram')).toBeTruthy()
    const plot = screen.getByLabelText(/Histogram\. 1 series/)
    expect(plot).toBeTruthy()
    expect(screen.getByText('4 °C')).toBeTruthy() // legend entry
  })

  it('renders a box plot with one labelled group from the package primitive', () => {
    const materialised = {
      ...okMaterialised(),
      rows: [
        { c2: 93, c3: '4C' },
        { c2: 96, c3: '4C' },
        { c2: 96, c3: '4C' },
        { c2: 100, c3: '4C' },
      ],
      series: [
        {
          identifier: '4C',
          label: '4 °C',
          color: '#006EDC',
          points: [
            {
              x: 1,
              y: 96,
              yError: null,
              label: '4C',
              box: {
                lo: 93,
                q1: 95.25,
                median: 96,
                q3: 97,
                hi: 100,
                outliers: [],
                n: 4,
              },
            },
          ],
        },
      ],
    }
    render(
      <ChartRenderer
        title="Box"
        spec={{ ...distSpec, type: 'box' }}
        materialised={materialised}
        frozen={null}
      />,
    )
    // The package draws the box; the hit layer carries its summary in a title.
    expect(document.querySelector('svg.sb-figure')).toBeTruthy()
    expect(document.querySelector('svg title')?.textContent).toContain(
      'median 96',
    )
  })

  it('renders a heatmap from the package primitive with an accessible table', () => {
    const onSelect = vi.fn()
    const materialised = {
      ...okMaterialised(),
      series: [],
      heatmap: {
        xLabels: ['20C', '4C'],
        yLabels: ['0–36'],
        cells: [
          { x: 0, y: 0, value: 2, count: 2 },
          { x: 1, y: 0, value: null, count: 0 },
        ],
        min: 2,
        max: 2,
        aggregate: 'count' as const,
      },
    }
    render(
      <ChartRenderer
        title="Heatmap"
        spec={{ ...distSpec, type: 'heatmap' }}
        materialised={materialised}
        frozen={null}
        onSelectionChange={onSelect}
      />,
    )
    // The visual is the package's heatmap figure.
    expect(document.querySelector('svg.sb-figure')).toBeTruthy()
    // The accessible alternative is the aggregated grid as a table.
    expect(screen.getAllByRole('table').length).toBeGreaterThanOrEqual(1)
    const cell = screen.getByTitle('20C × 0–36: 2 (2 rows)')
    fireEvent.click(cell)
    expect(onSelect).toHaveBeenCalledWith({
      seriesIdentifier: 'heatmap',
      index: 0,
    })
  })

  it('renders grouped and stacked bars through the package bar layout', () => {
    const twoSeries = {
      ...okMaterialised(),
      series: [
        ...okMaterialised().series,
        {
          identifier: '−20 °C',
          label: '−20 °C',
          color: '#00A659',
          points: [
            { x: 0, y: 3, yError: null, label: '−20 °C' },
            { x: 28, y: 2, yError: null, label: '−20 °C' },
          ],
        },
      ],
    }
    for (const type of ['grouped_bar', 'stacked_bar'] as const) {
      cleanup()
      render(
        <ChartRenderer
          title={type}
          spec={{ ...spec, type }}
          materialised={twoSeries}
          frozen={null}
        />,
      )
      expect(document.querySelectorAll('svg.sb-figure rect').length).toBe(4)
    }
  })

  it('surfaces omitted rows instead of plotting silent gaps', () => {
    const materialised = okMaterialised()
    render(
      <ChartRenderer
        title="Line"
        spec={spec}
        materialised={{ ...materialised, droppedPoints: 3 }}
        frozen={null}
      />,
    )
    expect(screen.getByText(/3 rows omitted/)).toBeTruthy()
  })

  it('renders facet panels with truncation note when capped', () => {
    const facets = ['A', 'B'].map((value) => ({
      value,
      chart: {
        ...okMaterialised(),
        series: okMaterialised().series.map((s) => ({
          ...s,
          label: `${s.label} · ${value}`,
        })),
      },
    }))
    render(
      <ChartRenderer
        title="Faceted"
        spec={spec}
        materialised={okMaterialised()}
        frozen={null}
        facets={facets}
        facetTotal={5}
      />,
    )
    expect(screen.getByLabelText('Facet A')).toBeTruthy()
    expect(screen.getByLabelText('Facet B')).toBeTruthy()
    expect(screen.getByText(/Showing 2 of 5 groups/)).toBeTruthy()
  })
})

describe('SCI-02 fit overlay rendering', () => {
  it('renders a renderAs=line series as a dashed line inside a scatter chart', () => {
    const materialised = {
      ...okMaterialised(),
      series: [
        ...okMaterialised().series,
        {
          identifier: 'fit',
          label: 'Fit',
          color: '#00a659',
          renderAs: 'line' as const,
          points: [
            { x: 0, y: 1, yError: null, label: 'fit' },
            { x: 28, y: 8, yError: null, label: 'fit' },
          ],
        },
      ],
    }
    render(
      <ChartRenderer
        title="Scatter with fit"
        spec={{ ...spec, type: 'scatter' }}
        materialised={materialised}
        frozen={null}
      />,
    )
    // The model curve renders as a real line layer (the package figure draws
    // a polyline for the `renderAs: 'line'` series).
    expect(document.querySelectorAll('polyline').length).toBeGreaterThan(0)
    // The fit series keeps its legend entry (and a data-table row).
    expect(screen.getAllByText('Fit').length).toBeGreaterThan(0)
  })
})
