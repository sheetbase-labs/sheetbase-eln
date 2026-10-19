import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SavedSearches } from './saved-searches'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('SavedSearches', () => {
  it('saves the current search under a name and applies it later', () => {
    const onApply = vi.fn()
    render(
      <SavedSearches
        workspaceId="ws-1"
        current={{ q: 'plate', owner: 'u-1', from: '2026-09-01' }}
        onApply={onApply}
      />,
    )
    expect(screen.getByText(/Saved searches stay in this browser/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save this search' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'My plates' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    fireEvent.click(screen.getByRole('button', { name: 'My plates' }))
    expect(onApply).toHaveBeenCalledWith({
      q: 'plate',
      owner: 'u-1',
      from: '2026-09-01',
    })
  })

  it('deletes a saved search', () => {
    render(
      <SavedSearches
        workspaceId="ws-1"
        current={{ q: 'plate' }}
        onApply={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save this search' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Plates' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete saved search Plates' }),
    )
    expect(screen.queryByRole('button', { name: 'Plates' })).toBeNull()
  })

  it('offers no save without a query', () => {
    render(
      <SavedSearches
        workspaceId="ws-1"
        current={{ q: '' }}
        onApply={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Save this search' }),
    ).toBeNull()
  })
})
