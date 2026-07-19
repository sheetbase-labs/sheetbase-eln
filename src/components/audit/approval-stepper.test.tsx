import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { ApprovalStepper } from './approval-stepper'
import type { ApprovalStepDef } from './approval-stepper'

afterEach(() => cleanup())
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const steps: ApprovalStepDef[] = [
  { id: 'draft', title: 'Draft', role: 'Author' },
  { id: 'sci', title: 'Scientific review', role: 'Emma Liu' },
  { id: 'qa', title: 'QA review', role: 'QA team' },
  { id: 'lock', title: 'Approved & locked' },
]

describe('ApprovalStepper', () => {
  it('renders steps in order with state labels', () => {
    render(
      <ApprovalStepper
        steps={steps}
        reviewState={{
          draft: {
            state: 'completed',
            actor: { name: 'Gareth Price' },
            at: '09:12',
          },
          sci: { state: 'active' },
        }}
      />,
    )
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('Scientific review')).toBeTruthy()
    expect(screen.getByText('QA review')).toBeTruthy()
    expect(screen.getByText('Approved & locked')).toBeTruthy()
    expect(screen.getByText(/Completed/)).toBeTruthy()
    expect(screen.getByText(/In progress/)).toBeTruthy()
    // Pending labels appear for unstate steps.
    expect(screen.getAllByText(/Pending/).length).toBeGreaterThanOrEqual(2)
  })

  it('distinguishes rejected and returned states with their own labels', () => {
    render(
      <ApprovalStepper
        steps={steps}
        reviewState={{
          draft: { state: 'completed' },
          sci: { state: 'rejected', actor: { name: 'Emma Liu' }, at: '12:00' },
          qa: { state: 'returned', at: '12:10' },
          lock: { state: 'unavailable' },
        }}
      />,
    )
    expect(screen.getByText(/Rejected/)).toBeTruthy()
    expect(screen.getByText(/Returned/)).toBeTruthy()
    expect(screen.getByText(/Unavailable/)).toBeTruthy()
  })

  it('exposes a complete sr-only sentence per step rather than relying on graphics', () => {
    render(
      <ApprovalStepper
        steps={steps}
        reviewState={{
          draft: {
            state: 'completed',
            actor: { name: 'Gareth Price' },
            at: '09:12',
          },
          sci: { state: 'active' },
          qa: { state: 'rejected', actor: { name: 'Emma Liu' }, at: '12:00' },
        }}
      />,
    )
    expect(
      screen.getByText('Draft: completed by Gareth Price at 09:12.'),
    ).toBeTruthy()
    expect(screen.getByText('Scientific review: in progress.')).toBeTruthy()
    expect(
      screen.getByText('QA review: rejected by Emma Liu at 12:00.'),
    ).toBeTruthy()
  })

  it('handles missing actor data honestly in the visible label', () => {
    render(
      <ApprovalStepper
        steps={steps}
        reviewState={{
          draft: { state: 'completed', actor: { name: 'x', unknown: true } },
        }}
      />,
    )
    expect(screen.getByText(/Unknown user/)).toBeTruthy()
  })

  it('treats a step absent from reviewState as pending', () => {
    render(<ApprovalStepper steps={steps} reviewState={{}} />)
    expect(screen.getAllByText(/Pending/).length).toBe(steps.length)
  })

  it('renders many steps inside a scroll region so long workflows stay usable', () => {
    const many: ApprovalStepDef[] = Array.from({ length: 30 }, (_, i) => ({
      id: `s${i}`,
      title: `Step ${i + 1}`,
    }))
    const { container } = render(
      <ApprovalStepper steps={many} reviewState={{}} />,
    )
    const list = container.querySelector('ol[aria-label="Approval workflow"]')
    expect(list).toBeTruthy()
    expect(list?.getAttribute('style') ?? '').toContain('max-height')
    expect(screen.getAllByText(/Step \d+/).length).toBeGreaterThanOrEqual(30)
  })
})
