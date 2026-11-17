import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { PlateMapFillSection } from '#/components/plates/plate-map-fill-section'
import { RunStepField } from '#/components/plates/run-step-field'

/** What a new plate run asks for beyond the file: its step, and its plate map. */
const samples = ['SMP-2231', 'SMP-2240', 'SMP-2241', 'SMP-2242'].map(
  (identifier, index) => ({
    id: `00000000-0000-4000-8000-00000000030${index}`,
    identifier,
  }),
)

const meta = {
  title: 'Plates/New run setup',
  component: PlateMapFillSection,
  tags: ['autodocs'],
  args: {
    samples,
    method: 'quantify',
    dilution: 1,
    format: '96_well',
    onFill: () => undefined,
  },
} satisfies Meta<typeof PlateMapFillSection>

export default meta

type Story = StoryObj<typeof meta>

export const QuantifyFill: Story = {}
export const ScreenFill: Story = { args: { method: 'screen' } }

export const StepField: Story = {
  render: () => (
    <RunStepField
      steps={[
        {
          block_id: 'a',
          step_number: 3,
          step_text: 'Filtrate turbidity',
          status: 'done',
          is_current: false,
          result_count: 1,
        },
        {
          block_id: 'b',
          step_number: 4,
          step_text: 'Capsid titre by ELISA, plates 1–4',
          status: 'in_progress',
          is_current: true,
          result_count: 0,
        },
      ]}
      value="b"
      onChange={() => undefined}
    />
  ),
}
