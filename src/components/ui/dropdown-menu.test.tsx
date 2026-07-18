import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'

afterEach(() => {
  cleanup()
})

async function setup(jsx: React.ReactElement) {
  const user = userEvent.setup()
  const utils = render(jsx)
  return { user, ...utils }
}

describe('DropdownMenu', () => {
  it('does not render content until triggered', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens on trigger click and renders a menu with items', async () => {
    const { user } = await setup(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    const menu = screen.getByRole('menu')
    expect(menu).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy()
  })

  it('fires onSelect when an item is chosen', async () => {
    const onSelect = vi.fn()
    const { user } = await setup(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('renders separators as separators with no menuitem role', async () => {
    const { user } = await setup(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByRole('button', { name: 'Menu' }))
    expect(screen.getByRole('separator')).toBeTruthy()
  })
})
