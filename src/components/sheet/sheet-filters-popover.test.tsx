import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SheetFiltersButton } from './sheet-filters-popover'
import type { SheetbaseGridColumn } from './sheetbase-grid'

const columns: SheetbaseGridColumn[] = [
  { id: 'train', label: 'Filter train', type: 'text', source: 'local' },
  { id: 'load', label: 'Load', type: 'number', source: 'local' },
  {
    id: 'clarity',
    label: 'Visual clarity',
    type: 'text',
    source: 'local',
    options: ['Clear', 'Hazy'],
  },
]

describe('SheetFiltersButton', () => {
  afterEach(cleanup)

  it('adds a filter as the sheet stores it, numbers as numbers', () => {
    const onChange = vi.fn()
    render(
      <SheetFiltersButton columns={columns} filters={[]} onChange={onChange} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(screen.getByText('No filters. Every row shows.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    fireEvent.change(screen.getByLabelText('Column'), {
      target: { value: 'load' },
    })
    const value = screen.getByLabelText('Value')
    fireEvent.change(value, { target: { value: '150' } })
    fireEvent.blur(value)

    expect(onChange).toHaveBeenLastCalledWith([
      { columnId: 'load', operator: 'equals', value: 150 },
    ])
  })

  it('shows the count, keeps filters on columns it does not show, and clears', () => {
    const onChange = vi.fn()
    render(
      <SheetFiltersButton
        columns={columns}
        filters={[
          { columnId: 'clarity', operator: 'equals', value: 'Clear' },
          { columnId: 'elsewhere', operator: 'is-empty' },
        ]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Filters · 1' }))
    expect(screen.getByDisplayValue('Visual clarity')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onChange).toHaveBeenLastCalledWith([
      { columnId: 'elsewhere', operator: 'is-empty' },
    ])
  })
})
