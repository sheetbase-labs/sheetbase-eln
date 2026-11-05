import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MilestoneTimeline,
  phaseBands,
  timelineTicks,
  timelineWindow,
} from './milestone-timeline'
import type { PlanMilestone } from './milestone-timeline'

afterEach(cleanup)

const SEP_29 = new Date(2026, 8, 29).getTime()
const NOW = new Date(2026, 8, 25, 9).getTime()

const localDay = (time: number) => new Date(time).toLocaleDateString('en-CA')

function milestone(overrides: Partial<PlanMilestone>): PlanMilestone {
  return {
    id: 'm-1',
    title: 'TFF and polish defined',
    dueAt: '2026-09-29T00:00:00Z',
    status: 'not_started',
    risk: 'on_track',
    clientVisible: false,
    workstreamId: 'phase-1',
    ...overrides,
  }
}

describe('timeline window and ticks', () => {
  it('spans whole months for the month scale', () => {
    const { start, end } = timelineWindow([SEP_29], NOW, 'month')
    expect(localDay(start)).toBe('2026-09-01')
    expect(localDay(end)).toBe('2026-10-01')
    expect(timelineTicks(start, end, 'month').map((t) => t.label)).toEqual([
      'Sep',
    ])
  })

  it('spans whole weeks, starting Monday, for the week scale', () => {
    const { start, end } = timelineWindow([SEP_29], NOW, 'week')
    expect(localDay(start)).toBe('2026-09-21')
    expect(localDay(end)).toBe('2026-10-05')
    expect(timelineTicks(start, end, 'week')).toHaveLength(2)
  })
})

describe('phaseBands', () => {
  it('groups milestones by phase in phase order with unphased last', () => {
    const bands = phaseBands(
      [
        milestone({ id: 'a', workstreamId: 'phase-1' }),
        milestone({ id: 'b', workstreamId: null }),
        milestone({ id: 'c', workstreamId: 'phase-2' }),
      ],
      [
        { id: 'phase-2', name: 'Downstream' },
        { id: 'phase-1', name: 'Upstream' },
      ],
    )
    expect(bands.map((band) => band.name)).toEqual([
      'Downstream',
      'Upstream',
      'Unphased',
    ])
    expect(bands[1].milestones.map((m) => m.id)).toEqual(['a'])
  })
})

describe('MilestoneTimeline', () => {
  it('shows the scale control, today marker, phase bars, client ring and dependency line', () => {
    const { container } = render(
      <MilestoneTimeline
        milestones={[
          milestone({ id: 'a', risk: 'at_risk' }),
          milestone({
            id: 'b',
            title: 'Release locked',
            dueAt: '2026-10-20T00:00:00Z',
            clientVisible: true,
          }),
        ]}
        phases={[{ id: 'phase-1', name: 'Upstream' }]}
        dependencies={[{ id: 'dep-1', predecessorId: 'a', successorId: 'b' }]}
        scale="month"
        onScaleChange={vi.fn()}
        selectedId="a"
        onSelect={vi.fn()}
        now={NOW}
      />,
    )
    expect(
      screen.getByRole('radiogroup', { name: 'Timeline scale' }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('radio', { name: 'Months' })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(screen.getByText('Upstream')).toBeTruthy()
    expect(screen.getByText(/Today/)).toBeTruthy()
    expect(container.querySelector('[data-today]')).toBeTruthy()
    expect(container.querySelector('[data-dependency="dep-1"]')).toBeTruthy()
    const client = screen.getByRole('button', { name: /Release locked/ })
    expect(client.className).toContain('ring-focus')
  })

  it('reports scale changes from the control and the arrow keys', async () => {
    const user = userEvent.setup()
    const onScaleChange = vi.fn()
    render(
      <MilestoneTimeline
        milestones={[milestone({})]}
        phases={[{ id: 'phase-1', name: 'Upstream' }]}
        dependencies={[]}
        scale="week"
        onScaleChange={onScaleChange}
        selectedId={null}
        onSelect={vi.fn()}
        now={NOW}
      />,
    )
    await user.click(screen.getByRole('radio', { name: 'Weeks' }))
    expect(onScaleChange).toHaveBeenCalledWith('week')
    await user.keyboard('{ArrowLeft}')
    expect(onScaleChange).toHaveBeenLastCalledWith('month')
  })

  it('renders nothing without a dated milestone', () => {
    const { container } = render(
      <MilestoneTimeline
        milestones={[milestone({ dueAt: null })]}
        phases={[]}
        dependencies={[]}
        scale="month"
        onScaleChange={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
        now={NOW}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('paints a passed phase as overdue while its milestones are open', () => {
    const { container } = render(
      <MilestoneTimeline
        milestones={[
          milestone({
            id: 'a',
            workstreamId: 'phase-1',
            dueAt: '2026-09-20T00:00:00Z',
            status: 'in_progress',
          }),
          milestone({
            id: 'b',
            workstreamId: 'phase-1',
            dueAt: '2026-09-22T00:00:00Z',
            status: 'completed',
          }),
        ]}
        phases={[{ id: 'phase-1', name: 'Upstream' }]}
        dependencies={[]}
        scale="month"
        onScaleChange={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
        now={NOW}
      />,
    )
    const band = container.querySelector('[data-band="phase-1"]')
    expect(band?.className).toContain('bg-danger-wash')
    expect(band?.className).not.toContain('bg-success-wash')
  })

  it('paints a passed phase as done once every milestone is completed', () => {
    const { container } = render(
      <MilestoneTimeline
        milestones={[
          milestone({
            id: 'a',
            workstreamId: 'phase-1',
            dueAt: '2026-09-20T00:00:00Z',
            status: 'completed',
          }),
        ]}
        phases={[{ id: 'phase-1', name: 'Upstream' }]}
        dependencies={[]}
        scale="month"
        onScaleChange={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
        now={NOW}
      />,
    )
    const band = container.querySelector('[data-band="phase-1"]')
    expect(band?.className).toContain('bg-success-wash')
  })

  it('lists the unknown-risk swatch in the legend', () => {
    render(
      <MilestoneTimeline
        milestones={[milestone({ risk: 'unknown' })]}
        phases={[{ id: 'phase-1', name: 'Upstream' }]}
        dependencies={[]}
        scale="month"
        onScaleChange={vi.fn()}
        selectedId={null}
        onSelect={vi.fn()}
        now={NOW}
      />,
    )
    expect(screen.getByText('Unknown risk')).toBeTruthy()
  })
})
