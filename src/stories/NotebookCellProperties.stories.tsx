import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookCellProperties } from '#/components/notebook/notebook-inspector'

/**
 * The Properties tab on its own: what the inspector knows about the selected
 * cell — value, validation, provenance and column definition. Every field is
 * optional, and an absent one is stated rather than left blank.
 */
const meta = {
  title: 'Notebook/Cell properties',
  component: NotebookCellProperties,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[320px] p-3">
        <Story />
      </div>
    ),
  ],
  args: {
    cell: {
      subject: 'Plate readings · row 6 · OD₆₀₀',
      value: { display: '0.34' },
      validation: {
        state: 'valid',
        headline: 'Within range',
        rule: 'OD range by time point',
      },
      provenance: {
        instrument: 'Plate reader 2',
        capturedAt: '29 Jul 2026, 09:41',
        enteredBy: 'Marco Silva',
        editedAt: '29 Jul 2026, 09:44',
      },
      column: {
        field: 'OD₆₀₀',
        type: 'Decimal',
        unit: 'AU',
        required: true,
        validation: '0 – 4',
        source: 'Bound to the plate-reader dataset',
      },
    },
  },
} satisfies Meta<typeof NotebookCellProperties>
export default meta
type Story = StoryObj<typeof meta>

export const Complete: Story = {}

/** A failing validation is shown with its detail, not softened. */
export const FailingValidation: Story = {
  args: {
    cell: {
      subject: 'Plate readings · row 9 · Turbidity',
      value: { display: '912 NTU', unit: 'NTU' },
      validation: {
        state: 'error',
        headline: 'Out of range',
        detail: 'The reporter expected 0 – 500 NTU.',
        rule: 'Turbidity range',
      },
    },
  },
}

/** Validation that could not be run is reported as unknown. */
export const UnknownValidation: Story = {
  args: {
    cell: {
      subject: 'Plate readings · row 4 · OD₆₀₀',
      value: { display: '0.12' },
      validation: { state: 'unknown', headline: 'Not checked yet' },
    },
  },
}

/** A cell with nothing selected above it. */
export const NothingSelected: Story = { args: { cell: null } }

/** Only a column is known: the value and provenance are stated as absent. */
export const ColumnOnly: Story = {
  args: {
    cell: {
      value: { display: null },
      column: { field: 'OD₆₀₀', type: 'Decimal', source: 'Dataset column' },
    },
  },
}
