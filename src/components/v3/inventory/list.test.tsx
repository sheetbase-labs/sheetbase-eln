/**
 * Registries (shared) — the toolbar renders a Sort/Filter/Fields control only
 * when the route supplies the handler that applies the choice, so a registry
 * never shows a menu that cannot change anything.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ListToolbar, ViewControls } from './list'

afterEach(cleanup)

describe('registry list toolbar', () => {
  it('renders no Sort menu for a route that supplies no onSort', () => {
    render(<ViewControls sorts={['Created', 'ID', 'Name']} />)
    expect(screen.queryByRole('button', { name: /Sort/ })).toBeNull()
  })

  it('applies the chosen sort key through onSort', async () => {
    const user = userEvent.setup()
    const onSort = vi.fn()
    render(
      <ViewControls sorts={['Updated', 'ID']} sort="Updated" onSort={onSort} />,
    )

    screen.getByRole('button', { name: 'Sort: Updated' }).focus()
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('menuitem', { name: 'ID' }))

    expect(onSort).toHaveBeenCalledWith('ID')
  })

  it('renders no Filter or Fields menu without a handler', () => {
    render(
      <ListToolbar
        q=""
        onSearch={() => {}}
        placeholder="Search samples"
        label="Search samples"
        views={{ sorts: ['Created'], fields: ['ID', 'Name'] }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fields' })).toBeNull()
  })

  it('reports a column toggle with the field the route must hide', async () => {
    const user = userEvent.setup()
    const onToggleField = vi.fn()
    render(
      <ListToolbar
        q=""
        onSearch={() => {}}
        placeholder="Search samples"
        label="Search samples"
        views={{
          sorts: ['Created'],
          onSort: () => {},
          fields: ['ID', 'Name'],
          hiddenFields: ['Name'],
          onToggleField,
        }}
      />,
    )

    screen.getByRole('button', { name: 'Fields' }).focus()
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('menuitem', { name: 'ID' }))

    expect(onToggleField).toHaveBeenCalledWith('ID')
  })
})
