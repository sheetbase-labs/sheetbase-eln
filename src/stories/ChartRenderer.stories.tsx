import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import { CHART_PALETTE } from '#/lib/chart-spec'

const spec: any = {
  specVersion: 1,
  type: 'line',
  datasets: [{ tableId: 'table-1' }],
  fields: {
    x: { columnId: 'x', fieldName: 'time' },
    y: { columnId: 'y', fieldName: 'od' },
    series: { columnId: 's', fieldName: 'condition' },
    color: null,
    size: null,
  },
  filters: [],
  transformations: [],
  display: {
    axes: {
      x: { label: 'Time', scale: 'linear', unit: 'h' },
      y: { label: 'OD₆₀₀', scale: 'linear' },
    },
    series: [{ identifier: '37 °C', label: '37 °C', color: CHART_PALETTE[0] }],
    legend: { visible: true },
  },
  overlays: { errorBars: null },
}

const materialised: any = {
  state: { kind: 'ok' },
  columns: [],
  rows: [
    { time: 0, od: 0.05 },
    { time: 2, od: 0.12 },
    { time: 4, od: 0.34 },
    { time: 6, od: 0.68 },
    { time: 8, od: 0.82 },
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
}

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
