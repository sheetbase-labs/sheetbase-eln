import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RecordHeader } from './record-header'

afterEach(() => cleanup())

const baseProps = {
  recordType: 'Experiment',
  title: 'Lentivector stability — 4°C hold',
  identifier: 'EXP-2025-0014',
}

describe('RecordHeader', () => {
  it('renders the type, title and identifier', () => {
    render(<RecordHeader {...baseProps} />)
    expect(screen.getByText('Experiment')).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 1, name: baseProps.title }),
    ).toBeTruthy()
    expect(screen.getByText('EXP-2025-0014')).toBeTruthy()
  })

  it('hides the identifier and status when not provided', () => {
    render(<RecordHeader recordType="Project" title="A project" />)
    expect(screen.queryByText('EXP-2025-0014')).toBeNull()
    expect(screen.queryByText('In progress')).toBeNull()
  })

  it('hides the metadata row entirely when no meta fields are provided', () => {
    render(<RecordHeader recordType="Notebook" title="Bare notebook" />)
    // No separator/meta row => no "Updated" label.
    expect(screen.queryByText(/Updated/)).toBeNull()
  })

  it('renders owner, updated, contributors (with +N overflow) and tags', () => {
    render(
      <RecordHeader
        {...baseProps}
        owner={{ name: 'Gareth Price', initials: 'GP' }}
        updatedAt="2h ago"
        contributors={Array.from({ length: 7 }, (_, i) => ({
          name: `Person ${i}`,
        }))}
        tags={<span>stability</span>}
      />,
    )
    expect(screen.getByText('Gareth Price')).toBeTruthy()
    expect(screen.getByText(/2h ago/)).toBeTruthy()
    expect(screen.getByText('+2')).toBeTruthy() // 7 - 5 overflow
    expect(screen.getByText('stability')).toBeTruthy()
  })

  it('renders actions and a star toggle that reports pressed state', async () => {
    const onStar = vi.fn()
    const user = userEvent.setup()
    render(
      <RecordHeader
        {...baseProps}
        starred
        onToggleStar={onStar}
        actions={<button type="button">Share</button>}
      />,
    )
    const star = screen.getByRole('button', { name: 'Unstar record' })
    expect(star.getAttribute('aria-pressed')).toBe('true')
    await user.click(star)
    expect(onStar).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
  })

  it('does not render a star button when no toggle is provided', () => {
    render(<RecordHeader {...baseProps} />)
    expect(screen.queryByRole('button', { name: /Star record/ })).toBeNull()
  })

  it('truncates a very long title without overflowing', () => {
    const longTitle = 'A'.repeat(400)
    render(<RecordHeader recordType="Experiment" title={longTitle} />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe(longTitle)
    expect(h1.className).toContain('truncate')
  })
})
