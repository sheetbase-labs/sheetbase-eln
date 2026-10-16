import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '#/components/reui/stepper'

/**
 * The ReUI `stepper` candidate (`src/components/reui/stepper.tsx`), installed
 * from the pinned base-nova registry and composed the way its own API intends.
 *
 * It is a wizard-navigation primitive, not the product's progress row: the
 * steps are buttons that change the active step (a roving tab stop), the
 * wrapper is a `role="tablist"`, `StepperNav` renders a `<nav>`, and its states
 * are active / completed / inactive — there is no failed step. The comparison
 * that declined it for the import flow is in
 * `docs/knowledge/design/component-comparison-record.md` (row 2), and the
 * measurements it rests on are pinned in
 * `src/components/component-compare/component-compare.a11y.test.tsx` (S1).
 *
 * Kept as a story so the declined candidate stays reviewable in the repository
 * rather than only in the record's prose.
 */
const STEPS = ['Upload', 'Map columns', 'Review and import']

function Row({ active }: { active: number }) {
  return (
    <Stepper value={active} className="max-w-xl">
      <StepperNav>
        {STEPS.map((label, index) => {
          const step = index + 1
          return (
            <StepperItem
              key={label}
              step={step}
              completed={step < active}
              className="min-w-0"
            >
              {/* `min-w-0` on the trigger, not only on the item: the button is
                  the flex child that holds the label, and without it the label
                  keeps its min-content width and the next step's indicator
                  overlaps it — measured at 1200px and 390px. */}
              <StepperTrigger className="min-w-0">
                <StepperIndicator>{step}</StepperIndicator>
                <StepperTitle className="truncate">{label}</StepperTitle>
              </StepperTrigger>
              {index < STEPS.length - 1 ? <StepperSeparator /> : null}
            </StepperItem>
          )
        })}
      </StepperNav>
    </Stepper>
  )
}

const meta = {
  title: 'ReUI/Stepper',
  component: Stepper,
  tags: ['autodocs'],
} satisfies Meta<typeof Stepper>
export default meta
type Story = StoryObj<typeof meta>

/** Part-way through: step one completed, step two active, step three inactive. */
export const InProgress: Story = { render: () => <Row active={2} /> }

/** Every step completed. */
export const Completed: Story = { render: () => <Row active={4} /> }
