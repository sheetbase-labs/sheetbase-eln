import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AddStepMenu } from '#/components/pipelines/step-list/add-step-menu'
import { NoCodeFormFields } from '#/components/pipelines/step-list/no-code-form'
import { StepRow } from '#/components/pipelines/step-list/step-row'
import { Status } from '#/components/ui/status'
import { NO_CODE_KINDS } from '#/lib/pipelines/no-code/forms'
import type { NoCodeForm, NoCodeKind } from '#/lib/pipelines/no-code/forms'
import { defaultForm } from '#/lib/pipelines/no-code/summary'

/**
 * The Standard editor's building blocks (`src/components/pipelines/step-list/`).
 *
 * A row of the step list in the states a run can leave it in, the grouped Add
 * step menu, and the pickers of each no-code step. The pickers hold their form
 * in state, so each one really edits it. The list itself, the settings panel
 * and the step bodies read the pipeline's draft and its runs, so they are
 * covered by the Steps route tests.
 */
const meta = {
  title: 'Pipelines/Step list',
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[760px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const Rows: Story = {
  render: () => (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <StepRow
        icon="filter"
        kind="Filter rows"
        summary="Keep rows where od600 > 0.4"
        rows="96 rows"
        status={<Status tone="ok">Passed</Status>}
        label="Step 1"
      />
      <StepRow
        icon="check"
        kind="Check ranges"
        summary="Turbidity ≤ 50 NTU"
        rows="3 out"
        rowsWarn
        status={<Status tone="warn">Waiting</Status>}
        label="Step 2"
      />
      <StepRow
        icon="table"
        kind="Calculate"
        summary="Calculate step_yield_pct"
        problem="Every term needs a column or a number, and an operator."
        label="Step 3"
        expanded
      />
    </div>
  ),
}

export const AddStep: Story = {
  render: () => <AddStepMenu count={3} onAdd={() => {}} />,
}

function FormStory({ kind }: { kind: NoCodeKind }) {
  const [form, setForm] = useState<NoCodeForm>(defaultForm(kind))

  return (
    <NoCodeFormFields
      kind={kind}
      form={form}
      onChange={setForm}
      columns={['sample', 'od600', 'turbidity', 'yield_pct']}
      inputs={[{ name: 'plates' }]}
      inputColumns={{ plates: ['well', 'plate'] }}
    />
  )
}

export const NoCodeForms: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {NO_CODE_KINDS.map((kind) => (
        <FormStory key={kind} kind={kind} />
      ))}
    </div>
  ),
}
