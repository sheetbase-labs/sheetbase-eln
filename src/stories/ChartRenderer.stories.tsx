import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { CHART_PALETTE } from '#/lib/chart-spec'
import type { ChartSpec, MaterialisedChart } from '#/lib/chart-spec'

/**
 * The renderer takes a spec, the rows the spec was materialised against, and
 * the optional frozen payload. Both fixtures are typed against those contracts
 * rather than `any`: the renderer reads `spec.typeParams` for the bar and
 * histogram parameters, so an untyped fixture fails at render instead of
 * drawing a chart.
 *
 * The dataset is fictitious and stands for the rows a chart block carries; no
 * read is issued.
 */
const spec = {
  specVersion: 1,
  type: 'line',
  datasets: [{ datasetId: 'dataset-1' }],
  fields: {
    x: { fieldId: 'x' },
    y: { fieldId: 'y' },
    series: { fieldId: 's' },
    color: null,
    size: null,
    facet: null,
  },
  filters: [],
  transformations: [],
  typeParams: {},
  display: {
    axes: {
      x: { label: 'Time', scale: 'linear', unit: 'h' },
      y: { label: 'OD₆₀₀', scale: 'linear' },
    },
    series: [{ identifier: '37 °C', label: '37 °C', color: CHART_PALETTE[0] }],
    legend: { visible: true },
  },
  overlays: { errorBars: null },
} satisfies ChartSpec

const materialised = {
  state: { kind: 'ok' },
  columns: [
    { id: 'x', label: 'Time', logicalType: 'number', unit: 'h' },
    { id: 'y', label: 'OD₆₀₀', logicalType: 'number' },
    { id: 's', label: 'Condition', logicalType: 'text' },
  ],
  rows: [
    { x: 0, y: 0.05, s: '37 °C' },
    { x: 2, y: 0.12, s: '37 °C' },
    { x: 4, y: 0.34, s: '37 °C' },
    { x: 6, y: 0.68, s: '37 °C' },
    { x: 8, y: 0.82, s: '37 °C' },
  ],
  series: [
    {
      identifier: '37 °C',
      label: '37 °C',
      color: CHART_PALETTE[0],
      points: [
        [0, 0.05],
        [2, 0.12],
        [4, 0.34],
        [6, 0.68],
        [8, 0.82],
      ].map(([x, y]) => ({ x, y, yError: null, label: '37 °C' })),
    },
  ],
  xLabel: 'Time',
  yLabel: 'OD₆₀₀',
  xUnit: 'h',
  yUnit: undefined,
  droppedPoints: 0,
} satisfies MaterialisedChart

const meta = {
  title: 'Visualization/Chart renderer',
  component: ChartRenderer,
  tags: ['autodocs'],
  args: { title: 'Bacterial growth curve', spec, materialised, frozen: null },
} satisfies Meta<typeof ChartRenderer>

export default meta
type Story = StoryObj<typeof meta>

export const Line: Story = {}

export const Scatter: Story = {
  args: {
    spec: { ...spec, type: 'scatter' },
    title: 'Concentration vs response',
  },
}

export const Bar: Story = {
  args: {
    spec: { ...spec, type: 'bar' },
    title: 'Endpoint yield by condition',
  },
}

export const Empty: Story = {
  args: {
    materialised: {
      ...materialised,
      state: { kind: 'empty_dataset' },
      rows: [],
      series: [],
    },
  },
}

export const Loading: Story = {
  args: { loading: true },
}

export const ChartError: Story = {
  args: { error: 'The instrument dataset could not be loaded.' },
}
