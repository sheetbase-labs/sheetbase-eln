import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PlateMap } from './plate-map'
import type { PlateWell } from './plate-map'

afterEach(() => cleanup())

const wells: PlateWell[] = [
  { row: 0, col: 0, value: 0.1, label: 'A1 positive control' },
  { row: 0, col: 1, value: 0.9 },
  { row: 1, col: 0, value: null }, // missing
  { row: 1, col: 1 }, // missing (no value)
]

describe('PlateMap', () => {
  it('renders a grid with row and column labels', () => {
    render(<PlateMap wells={wells} ariaLabel="96-well plate" />)
    expect(screen.getByRole('grid', { name: '96-well plate' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '1' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: '12' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'A' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'H' })).toBeTruthy()
  })

  it('labels each well button and distinguishes empty wells', () => {
    render(<PlateMap wells={wells} />)
    expect(
      screen.getByRole('button', { name: 'A1 positive control' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'B1 (empty)' })).toBeTruthy()
  })

  it('selects a well on click and reports the index', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<PlateMap wells={wells} onSelect={onSelect} />)
    await user.click(
      screen.getByRole('button', { name: 'A1 positive control' }),
    )
    expect(onSelect).toHaveBeenCalledWith(0)
  })

  it('marks the selected well with aria-selected', () => {
    render(<PlateMap wells={wells} selectedIndex={1} />)
    const buttons = screen.getAllByRole('button')
    const selected = buttons.find(
      (b) => b.getAttribute('aria-selected') === 'true',
    )
    expect(selected).toBeTruthy()
    // The selected button should be the A2 well (index 1).
    expect(selected?.getAttribute('aria-label')).toBe('A2')
  })

  it('renders a legend from the bands', () => {
    render(<PlateMap wells={wells} />)
    expect(screen.getByText('Low')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('Empty')).toBeTruthy()
  })

  it('supports keyboard focus on well buttons', () => {
    render(<PlateMap wells={wells} />)
    const first = screen.getByRole('button', { name: 'A1 positive control' })
    first.focus()
    expect(document.activeElement).toBe(first)
  })
})
