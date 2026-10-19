import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MoveSampleDialog } from './move-dialog'

afterEach(cleanup)

function mount(onSubmit = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MoveSampleDialog
        open
        onOpenChange={() => {}}
        sample={{ identifier: 'SMP-1', storageLocation: 'Freezer 1 / Rack 2' }}
        busy={false}
        onSubmit={onSubmit}
        locations={['Freezer 1 / Rack 2', 'Bench']}
      />
    </QueryClientProvider>,
  )
  return onSubmit
}

describe('MoveSampleDialog', () => {
  it('shows where the sample is and offers the places in use', () => {
    mount()
    expect(screen.getByText(/Now at Freezer 1 \/ Rack 2/)).toBeTruthy()
    expect(document.querySelectorAll('datalist option')).toHaveLength(2)
  })

  it('moves to the chosen place, trimmed', () => {
    const onSubmit = mount()
    fireEvent.change(screen.getByLabelText(/New location/), {
      target: { value: '  Bench ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(onSubmit).toHaveBeenCalledWith('Bench')
  })

  it('holds a move to where the sample already is, and says why', () => {
    const onSubmit = mount()
    fireEvent.change(screen.getByLabelText(/New location/), {
      target: { value: 'freezer 1 / rack 2' },
    })
    expect(
      screen.getByText('SMP-1 is already at Freezer 1 / Rack 2.'),
    ).toBeTruthy()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Move' }).disabled,
    ).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does nothing until a location is typed', () => {
    mount()
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Move' }).disabled,
    ).toBe(true)
  })
})
