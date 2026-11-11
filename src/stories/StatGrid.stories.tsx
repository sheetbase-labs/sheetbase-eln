import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { StatGrid } from '#/components/viz/stat-grid'
import type { StatColumn } from '#/components/viz/stat-grid'

interface Group {
  group: string
  n: number
  mean: number
  sd: number
  note: string
}

const ROWS: Group[] = [
  { group: 'V01', n: 21, mean: 11.2, sd: 6.2, note: 'Included' },
  { group: 'V02', n: 21, mean: 10.9, sd: 6.1, note: 'Included' },
  { group: 'V03', n: 21, mean: 11.4, sd: 6.3, note: 'One flagged value' },
]

const COLUMNS: StatColumn<Group>[] = [
  {
    id: 'group',
    header: 'Group',
    value: (r) => r.group,
    text: true,
    strong: true,
  },
  { id: 'n', header: 'n', value: (r) => r.n },
  {
    id: 'mean',
    header: 'mean',
    value: (r) => r.mean.toFixed(1),
    sortBy: (r) => r.mean,
  },
  {
    id: 'sd',
    header: 'sd',
    value: (r) => r.sd.toFixed(1),
    sortBy: (r) => r.sd,
  },
  {
    id: 'note',
    header: 'Note',
    value: (r) => r.note,
    text: true,
    tone: (r) =>
      r.note === 'Included' ? 'text-fg-muted' : 'text-warning-text',
  },
]

/** A small result table: figures right-aligned, a column of words, a toned cell. */
const meta = {
  title: 'UI/Stat grid',
  component: StatGrid<Group>,
  tags: ['autodocs'],
  args: {
    label: 'Descriptive statistics per group',
    rows: ROWS,
    columns: COLUMNS,
    getRowId: (row: Group) => row.group,
  },
} satisfies Meta<typeof StatGrid<Group>>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Drawn inside a box that already has a border. */
export const Bare: Story = { args: { bare: true } }

/** A long result is capped and scrolls inside. */
export const Capped: Story = { args: { maxHeight: 100 } }
