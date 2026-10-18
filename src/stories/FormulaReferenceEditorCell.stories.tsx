import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { FormulaReferenceEditorCell } from '#/components/sheet/formula-reference-editor'

/**
 * COMP-06 step 3 — the in-cell formula editor the grid hosts for formula
 * columns. It commits on Enter/Tab, cancels on Escape and commits on blur, so
 * the stories supply the same callbacks the grid does and report the outcome
 * beside the cell.
 */
function Harness({
  initialDraft,
  point = { row: 3, column: 2 },
}: {
  initialDraft: string
  point?: { row: number; column: number }
}) {
  const [outcome, setOutcome] = useState('Editing…')
  const [draft, setDraft] = useState(initialDraft)
  return (
    <div className="w-[420px] space-y-2">
      <div className="rounded-md border border-border p-2">
        <FormulaReferenceEditorCell
          point={point}
          initialDraft={draft}
          commit={(value) => {
            setDraft(value)
            setOutcome(`Committed: ${value}`)
          }}
          cancel={() => setOutcome('Cancelled — nothing written')}
        />
      </div>
      <p className="text-xs text-fg-muted" role="status">
        {outcome}
      </p>
    </div>
  )
}

const meta = {
  title: 'Sheet/Formula reference editor cell',
  component: FormulaReferenceEditorCell,
  tags: ['autodocs'],
  args: {
    point: { row: 3, column: 2 },
    initialDraft: '=SUM(A1:A4)',
    commit: () => {},
    cancel: () => {},
  },
} satisfies Meta<typeof FormulaReferenceEditorCell>
export default meta
type Story = StoryObj<typeof meta>

/** An existing formula, opened for editing. */
export const EditingFormula: Story = {
  render: () => <Harness initialDraft="=SUM(A1:A4)" />,
}

/** A half-typed reference: the dropdown below suggests functions for it. */
export const TypingFunction: Story = {
  render: () => <Harness initialDraft="=AV" />,
}

/** An empty cell in a formula column: the editor opens with nothing. */
export const EmptyCell: Story = {
  render: () => <Harness initialDraft="" point={{ row: 1, column: 1 }} />,
}

/** A long formula stays inside the cell's editor. */
export const LongFormula: Story = {
  render: () => (
    <Harness initialDraft="=IF(AND(B2>0,B3<10),ROUND(B2*B3,3),AVERAGE(B2:B9))" />
  ),
}
