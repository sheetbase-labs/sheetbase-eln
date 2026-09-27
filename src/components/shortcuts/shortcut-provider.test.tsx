import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShortcutProvider } from './shortcut-provider'

afterEach(cleanup)

describe('ShortcutProvider', () => {
  it('fires a sequence shortcut', async () => {
    const user = userEvent.setup()
    const home = vi.fn()
    render(
      <ShortcutProvider
        definitions={[
          {
            id: 'home',
            scope: 'global',
            keys: ['g h'],
            description: 'Home',
            handler: home,
          },
        ]}
      >
        <div />
      </ShortcutProvider>,
    )
    await user.keyboard('g')
    await user.keyboard('h')
    expect(home).toHaveBeenCalledOnce()
  })

  it('suppresses shortcuts while typing in an input', async () => {
    const user = userEvent.setup()
    const home = vi.fn()
    render(
      <ShortcutProvider
        definitions={[
          {
            id: 'home',
            scope: 'global',
            keys: ['g h'],
            description: 'Home',
            handler: home,
          },
        ]}
      >
        <input aria-label="Search" />
      </ShortcutProvider>,
    )
    await user.click(screen.getByLabelText('Search'))
    await user.keyboard('g')
    await user.keyboard('h')
    expect(home).not.toHaveBeenCalled()
  })
})
