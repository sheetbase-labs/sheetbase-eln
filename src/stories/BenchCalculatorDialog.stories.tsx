import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { BenchCalculatorDialog } from '#/components/calculators/bench-calculator-dialog'

/** Molarity, dilution and unit conversion. Opens from the notebook insert menu and the sheet toolbar. */
const meta = {
  title: 'Calculators/Bench calculator',
  component: BenchCalculatorDialog,
  tags: ['autodocs'],
  args: { open: true, onOpenChange: () => {}, onInsert: () => {} },
} satisfies Meta<typeof BenchCalculatorDialog>

export default meta

type Story = StoryObj<typeof meta>

/** With an insert action, as in a notebook. */
export const InNotebook: Story = {}

/** Without one, as in a sheet: the answer can only be copied. */
export const InSheet: Story = { args: { onInsert: undefined } }
