import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Stepper } from '#/components/v3/ui/stepper'

/**
 * The step-progress row (`src/components/v3/ui/stepper.tsx`): an ordered list of
 * stages with the steps behind the current one ticked, `aria-current="step"` on
 * the current one, and a `failed` marker reserved for a flow that stopped on a
 * step. It is display-only — the row reports progress, it is not a picker, so
 * none of it is focusable.
 *
 * The import flow is its product surface
 * (`src/components/import/import-flow.tsx:334`, `:854`); the shipped contract —
 * a list named "Steps", one item per step, `aria-current="step"` — is asserted
 * by `tests/browser/import-flow.test.ts:185-193`.
 */
const meta = {
  title: 'UI/Stepper',
  component: Stepper,
  tags: ['autodocs'],
  args: { steps: ['Upload', 'Map columns', 'Review and import'], current: 1 },
} satisfies Meta<typeof Stepper>
export default meta
type Story = StoryObj<typeof meta>

/** The default state: the first step is current and nothing is done yet. */
export const Set: Story = {}

/** Part-way through: the steps behind are done, the ones ahead still to come. */
export const InProgress: Story = { args: { current: 2 } }

/** On the last step, with every step behind it done. */
export const OnTheLastStep: Story = { args: { current: 3 } }

/** The reserved failed marker: the flow stopped on the current step. */
export const Failed: Story = { args: { current: 2, failed: true } }
