import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetGrid } from '#/components/v3/ui/sheet-grid'
import type { GridColumn } from '#/components/v3/ui/sheet-grid'

/**
 * The read-and-navigate sheet: 28px rows, visible grid lines, row numbers, a
 * derived cell tinted, and a Source label in each header. It is a `role="grid"`
 * with one roving tab stop — the arrow keys move the active cell, Home and End
 * jump within the row, and only the active cell is tabbable.
 *
 * Editing, selection ranges and virtualisation are not this component's job.
 */
type Reading = {
  time: string
  load: number
  pressure: number
  flux: number
  yield: number
}

const READINGS: Reading[] = [
  { time: '0:00', load: 0, pressure: 0.4, flux: 142.5, yield: 96.8 },
  { time: '0:30', load: 62, pressure: 0.9, flux: 118.2, yield: 92.1 },
  { time: '1:00', load: 128, pressure: 1.6, flux: 86.4, yield: 84.5 },
  { time: '1:30', load: 141, pressure: 2.1, flux: 61.8, yield: 75.6 },
  { time: '2:00', load: 150, pressure: 2.8, flux: 40.2, yield: 68.3 },
]

const COLUMNS: GridColumn<Reading>[] = [
  {
    key: 'time',
    label: 'Time',
    source: { kind: 'dataset', label: 'DS-0310' },
    cell: (r) => r.time,
  },
  {
    key: 'load',
    label: 'Load',
    unit: 'L/m²',
    align: 'right',
    source: { kind: 'dataset', label: 'DS-0310' },
    cell: (r) => r.load,
  },
  {
    key: 'pressure',
    label: 'TMP',
    unit: 'bar',
    align: 'right',
    source: { kind: 'dataset', label: 'DS-0310' },
    cell: (r) => r.pressure.toFixed(1),
  },
  {
    key: 'flux',
    label: 'Flux',
    unit: 'L/m²·h',
    align: 'right',
    source: { kind: 'dataset', label: 'DS-0310' },
    cell: (r) => r.flux.toFixed(1),
  },
  {
    key: 'yield',
    label: 'Step yield',
    unit: '%',
    align: 'right',
    derived: true,
    source: { kind: 'calc', label: 'Calculated' },
    cell: (r) => r.yield.toFixed(1),
  },
]

type Variant = 'default' | 'override' | 'invalid' | 'unsourced'

function ReadingsGrid({
  variant = 'default',
  label = 'Filtration readings',
}: {
  variant?: Variant
  label?: string
}) {
  const columns = COLUMNS.map((column) => {
    if (variant === 'override' && column.key === 'flux') {
      // A local override is the one source that is not citable until it is
      // promoted, so it is drawn in link blue rather than the muted grey.
      return {
        ...column,
        source: { kind: 'local' as const, label: 'Local override' },
      }
    }
    if (variant === 'unsourced') {
      return { ...column, source: undefined }
    }
    return column
  })

  return (
    <SheetGrid<Reading>
      label={label}
      columns={columns}
      rows={READINGS}
      invalid={
        variant === 'invalid'
          ? (row, key) =>
              row.load > 140 && (key === 'flux' || key === 'pressure')
          : undefined
      }
    />
  )
}

const meta = {
  title: 'v3 kit/Sheet grid',
  component: ReadingsGrid,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { variant: 'default' },
} satisfies Meta<typeof ReadingsGrid>
export default meta
type Story = StoryObj<typeof meta>

/** A run's readings. Derived columns are tinted and say so in their header. */
export const Default: Story = {}

/** One value came from a person, not the instrument, and the header says which. */
export const WithLocalOverride: Story = { args: { variant: 'override' } }

/** Cells a validation failed are marked; keyboard focus reaches them like any other. */
export const WithInvalidCells: Story = { args: { variant: 'invalid' } }

/** A header with no source is a column that is not imported from anywhere. */
export const WithoutSources: Story = { args: { variant: 'unsourced' } }

/** The grid's accessible name is the caller's, and it is required. */
export const Named: Story = {
  args: { label: 'Filtration readings, run 148' },
}
