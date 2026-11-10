import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import {
  Stepper,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from './stepper'

/**
 * The wizard's keyboard contract: the triggers are one roving tab stop, and the
 * arrow keys move between them.
 *
 * The second test is the regression. Each trigger registers its button with the
 * stepper so the arrow keys know the order; registration used to run in an
 * effect keyed on `ref.current`, so when the rendered element changed — a
 * `render` prop swapping the button for an anchor, or any remount that keeps the
 * component — the effect never ran again and the stepper kept pointing at nodes
 * that were no longer in the document.
 */

const STEPS = ['Upload', 'Map columns', 'Review and import']

afterEach(cleanup)

function Wizard({ anchor = false }: { anchor?: boolean }) {
  return (
    <Stepper defaultValue={1}>
      <StepperNav>
        {STEPS.map((label, index) => {
          const step = index + 1

          return (
            <StepperItem key={label} step={step}>
              <StepperTrigger
                render={anchor ? <a href={`#step-${step}`} /> : undefined}
              >
                <StepperTitle>{label}</StepperTitle>
                {index < STEPS.length - 1 ? <StepperSeparator /> : null}
              </StepperTrigger>
            </StepperItem>
          )
        })}
      </StepperNav>
    </Stepper>
  )
}

function trigger(label: string): HTMLElement {
  return screen.getByRole('tab', { name: label })
}

describe('Stepper', () => {
  it('moves the focus with the arrow keys, and wraps at both ends', async () => {
    const user = userEvent.setup()
    render(<Wizard />)

    await user.click(trigger('Upload'))
    expect(document.activeElement).toBe(trigger('Upload'))

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(trigger('Map columns'))

    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(document.activeElement).toBe(trigger('Review and import'))

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(trigger('Upload'))

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(trigger('Review and import'))
  })

  it('keeps navigating after the trigger element is replaced', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Wizard />)

    // One ordinary re-render first, which is what leaves the registration
    // effect settled on the old node.
    rerender(<Wizard />)

    // The same trigger components now render anchors, so every button node is
    // replaced while the stepper keeps its mounted state.
    rerender(<Wizard anchor />)
    expect(trigger('Upload').tagName).toBe('A')

    await user.click(trigger('Upload'))
    expect(document.activeElement).toBe(trigger('Upload'))

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(trigger('Map columns'))
  })

  it('selects the step with Enter and Space', async () => {
    const user = userEvent.setup()

    render(
      <Stepper defaultValue={1}>
        <StepperNav>
          <StepperItem step={1}>
            <StepperTrigger>
              <StepperTitle>Upload</StepperTitle>
            </StepperTrigger>
          </StepperItem>
          <StepperItem step={2}>
            <StepperTrigger>
              <StepperTitle>Map columns</StepperTitle>
            </StepperTrigger>
          </StepperItem>
        </StepperNav>
      </Stepper>,
    )

    await user.click(trigger('Map columns'))
    expect(trigger('Map columns').getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{ArrowLeft}{Enter}')
    expect(trigger('Upload').getAttribute('aria-selected')).toBe('true')
  })
})
