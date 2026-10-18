import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RunPromptPanel } from '#/components/v3/pipelines/run-prompt'
import type { PipelineRunPromptWire } from '#/lib/pipelines/types'

/**
 * The run's human gate (`src/components/v3/pipelines/run-prompt.tsx`).
 *
 * A step that raises a prompt stops the run until someone answers it. The panel
 * renders the author's own form schema — fields, required markers, the proposal
 * the step is asking about — and, once answered, the decision that was taken
 * rather than a form. `canAnswer` is false when the run is no longer waiting,
 * which the panel says plainly instead of offering a decision that would be
 * refused.
 */
const meta = {
  title: 'Pipelines/Run prompt',
  component: RunPromptPanel,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[820px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RunPromptPanel>
export default meta
type Story = StoryObj<typeof meta>

const asked = ['user-1', 'user-2']
const nameOf = (id: string) =>
  id === 'user-1' ? 'Ada Scientist' : id === 'user-2' ? 'Marco Silva' : id

const formSchema: Record<string, unknown> = {
  title: 'Confirm the plate layout change',
  description:
    'The step proposes moving three wells to column 12. Confirm the layout before the run writes results.',
  fields: [
    {
      key: 'layoutConfirmed',
      label: 'Layout matches the plate reader export',
      type: 'boolean',
      required: true,
    },
    { key: 'plateId', label: 'Plate ID', type: 'text', required: true },
    {
      key: 'readAt',
      label: 'Reading taken',
      type: 'timestamp',
      required: false,
    },
    {
      key: 'plateType',
      label: 'Plate type',
      type: 'text',
      required: true,
      options: ['96-well flat', '384-well flat'],
    },
  ],
  proposal: {
    step: 'confirm-layout',
    rows: [
      { well: 'A12', from: 'empty', to: 'sample S-2291' },
      { well: 'B12', from: 'empty', to: 'sample S-2292' },
      { well: 'C12', from: 'empty', to: 'sample S-2293' },
    ],
  },
}

function prompt(
  overrides: Partial<PipelineRunPromptWire> = {},
): PipelineRunPromptWire {
  return {
    id: 'prompt-1',
    workspace_id: 'ws-1',
    run_id: 'run-1',
    step_id: 'confirm-layout',
    form_schema: formSchema,
    asked_user_ids: asked,
    answer: null,
    answered_by_user_id: null,
    answered_at: null,
    expires_at: '2026-10-03T09:00:00.000Z',
    created_at: '2026-10-02T10:05:00.000Z',
    ...overrides,
  }
}

const noop = () => {}

/** Waiting for an answer: the schema's fields, the proposal, and three decisions. */
export const Waiting: Story = {
  args: {
    prompt: prompt(),
    canAnswer: true,
    nameOf,
    onAnswer: noop,
  },
}

/** The run is no longer waiting, so the panel offers no answer to give. */
export const NoLongerWaiting: Story = {
  args: {
    prompt: prompt(),
    canAnswer: false,
    nameOf,
  },
}

/** Answering: the buttons are held while the answer is written. */
export const Submitting: Story = {
  args: {
    prompt: prompt(),
    canAnswer: true,
    nameOf,
    onAnswer: noop,
    submitting: true,
  },
}

/** A refused answer keeps the form and says what failed. */
export const AnswerFailed: Story = {
  args: {
    prompt: prompt(),
    canAnswer: true,
    nameOf,
    onAnswer: noop,
    error:
      'The answer was refused: this prompt was already answered by someone else.',
  },
}

/** Answered: the decision, the values it carried, the reason and who gave it. */
export const Answered: Story = {
  args: {
    prompt: prompt({
      answer: {
        decision: 'skip',
        values: { plateId: 'P-3391', plateType: '96-well flat' },
        reason: 'The layout is revised; this run should not write results.',
      },
      answered_by_user_id: 'user-2',
      answered_at: '2026-10-02T10:20:00.000Z',
    }),
    canAnswer: false,
    nameOf,
  },
}

/** A schema nobody wrote fields into: the title falls back to the step id. */
export const BareSchema: Story = {
  args: {
    prompt: prompt({ form_schema: {} }),
    canAnswer: true,
    nameOf,
    onAnswer: noop,
  },
}
