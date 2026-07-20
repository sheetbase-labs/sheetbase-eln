import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ScientificApiInspector } from './scientific-api-inspector'
import type { ScientificTableWire } from '#/lib/scientific-sheet-data'

const table: ScientificTableWire = {
  id: '10000000-0000-4000-8000-000000000001',
  resource_name: `sheet_${'a'.repeat(26)}`,
  name: 'Stability results',
  schema_version: 4,
  lifecycle: 'active',
  columns: [
    {
      id: '10000000-0000-4000-8000-000000000002',
      field_name: 'col_sample',
      label: 'Sample',
      display_order: 1,
      logical_type: 'text',
      nullable: false,
      unit: null,
      validation: { minLength: 2 },
      width: null,
      options: [],
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      field_name: 'col_mass',
      label: 'Mass',
      display_order: 2,
      logical_type: 'decimal',
      nullable: true,
      unit: { code: 'mg', symbol: 'mg' },
      validation: { min: 0 },
      width: null,
      options: [],
    },
  ],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ScientificApiInspector', () => {
  it('connects display labels, API names, stable identities, types and rules', () => {
    render(
      <ScientificApiInspector
        table={table}
        selectedRowId="10000000-0000-4000-8000-000000000004"
        selectedRowVersion={3}
        selectedColumnId={table.columns[1].id}
      />,
    )
    fireEvent.click(screen.getByText(/API inspector/))
    expect(screen.getByText('Stability results')).toBeTruthy()
    expect(screen.getAllByText('col_mass').length).toBeGreaterThan(0)
    expect(screen.getByText('PostgreSQL numeric')).toBeTruthy()
    expect(screen.getByText('REST JSON number')).toBeTruthy()
    expect(screen.getByText(/May be empty · min: 0/)).toBeTruthy()
    expect(screen.getByText(/version 3/)).toBeTruthy()
  })

  it('shows both access modes, safe examples, and copies only placeholders', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<ScientificApiInspector table={table} />)
    fireEvent.click(screen.getByText(/API inspector/))
    expect(screen.getByText(/signed-in session/)).toBeTruthy()
    expect(screen.getByText(/External integrations/)).toBeTruthy()
    expect(screen.getByText('List rows')).toBeTruthy()
    expect(screen.getByText('Filter rows')).toBeTruthy()
    expect(screen.getByText('Insert a row')).toBeTruthy()
    expect(screen.getByText('Update the selected row safely')).toBeTruthy()
    expect(screen.getByText(/never reads or displays/)).toBeTruthy()
    expect(screen.getByText(/derived cache data/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0])
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('$TOKEN')
    expect(writeText.mock.calls[0][0]).not.toMatch(/sb_[0-9a-f]{8}_/)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })
})
