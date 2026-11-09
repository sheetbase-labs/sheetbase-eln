import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { LeveyJenningsChart } from '#/components/quality/levey-jennings-chart'
import type { QcPointRow, QcSeriesRow } from '#/lib/run-qc'

const series: QcSeriesRow = {
  id: 's1',
  name: 'Qubit 4 standard 1',
  source_kind: 'manual',
  design_id: null,
  metric: null,
  instrument_id: null,
  unit: 'ng/µL',
  mean: 100,
  sd: 4,
  baseline_n: null,
  baseline_from: null,
  baseline_to: null,
  rules: ['1-3s', '2-2s', 'R-4s', '4-1s', '10x'],
  enabled: true,
  state: 'in_control',
  state_changed_at: '2026-11-01T09:00:00Z',
  created_by_user_id: null,
  created_at: '2026-10-01T09:00:00Z',
}

const values = [
  101, 98, 103, 99, 100, 104, 97, 102, 106, 109, 108, 100, 99, 112, 101,
]

function pointsFor(rows: number[], broken: Record<number, string[]> = {}) {
  return rows.map((value, index): QcPointRow => ({
    id: `p${index}`,
    series_id: 's1',
    plate_run_id: null,
    instrument_run_id: null,
    value,
    at: new Date(Date.UTC(2026, 10, 1 + index)).toISOString(),
    label: `Run ${index + 1}`,
    z: (value - 100) / 4,
    violations: (broken[index] ?? []) as QcPointRow['violations'],
    excluded: false,
    acknowledged_at: null,
    acknowledged_by_user_id: null,
    note: null,
  }))
}

const meta = {
  title: 'Quality/Levey-Jennings chart',
  component: LeveyJenningsChart,
  args: { series, points: pointsFor(values, { 13: ['1-3s'] }) },
} satisfies Meta<typeof LeveyJenningsChart>

export default meta

type Story = StoryObj<typeof meta>

export const WithABreach: Story = {}

export const InControl: Story = {
  args: { points: pointsFor(values.slice(0, 8)) },
}

export const NoLimits: Story = {
  args: {
    series: { ...series, mean: null, sd: null },
    points: pointsFor(values),
  },
}

export const NoRunsYet: Story = { args: { points: [] } }
