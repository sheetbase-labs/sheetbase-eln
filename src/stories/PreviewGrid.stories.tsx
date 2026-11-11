import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PreviewGrid } from '#/components/inventory/preview-grid'

/**
 * A preview of rows whose columns are only known at run time (a source table,
 * a mapped file, a step's output). Synthetic rows; nothing is read.
 */
const meta = {
  title: 'UI/Preview grid',
  component: PreviewGrid,
  tags: ['autodocs'],
  args: {
    label: 'First rows of the file',
    columns: ['Vessel', 'Day', 'VCD (×10⁶ cells/mL)', 'Viability (%)'],
    rows: [
      {
        Vessel: 'V01',
        Day: 2,
        'VCD (×10⁶ cells/mL)': 3.8,
        'Viability (%)': 96.1,
      },
      {
        Vessel: 'V02',
        Day: 2,
        'VCD (×10⁶ cells/mL)': 4.1,
        'Viability (%)': 95.8,
      },
      {
        Vessel: 'V03',
        Day: 6,
        'VCD (×10⁶ cells/mL)': 12.4,
        'Viability (%)': null,
      },
    ],
  },
} satisfies Meta<typeof PreviewGrid>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Number columns sit right-aligned, and a tall preview is capped and scrolls. */
export const NumbersAndCap: Story = {
  args: {
    numericColumns: ['Day', 'VCD (×10⁶ cells/mL)', 'Viability (%)'],
    maxHeight: 140,
  },
}

/** The row a chart point came from is shaded. */
export const SelectedRow: Story = { args: { selectedRow: 1 } }
