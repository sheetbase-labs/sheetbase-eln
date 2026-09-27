import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ShortcutProvider,
  useRegisterShortcuts,
  useShortcutScope,
} from './shortcut-provider'

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

describe('route-scoped shortcuts (SHELL-03.3)', () => {
  function ListScene({ onNext }: { onNext: () => void }) {
    useShortcutScope('list')
    useRegisterShortcuts(
      React.useMemo(
        () => [
          {
            id: 'next',
            scope: 'list' as const,
            keys: ['j'],
            description: 'Next item',
            handler: onNext,
          },
        ],
        [onNext],
      ),
    )
    return <div />
  }

  it('fires a registered list shortcut while the scene is mounted', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(
      <ShortcutProvider definitions={[]}>
        <ListScene onNext={onNext} />
      </ShortcutProvider>,
    )
    await user.keyboard('j')
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('stops firing after the scene unmounts', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    const { rerender } = render(
      <ShortcutProvider definitions={[]}>
        <ListScene onNext={onNext} />
      </ShortcutProvider>,
    )
    await user.keyboard('j')
    expect(onNext).toHaveBeenCalledOnce()
    rerender(
      <ShortcutProvider definitions={[]}>
        <div />
      </ShortcutProvider>,
    )
    await user.keyboard('j')
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('does not fire a list shortcut in the global scope', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(
      <ShortcutProvider
        definitions={[
          {
            id: 'next',
            scope: 'list',
            keys: ['j'],
            description: 'Next item',
            handler: onNext,
          },
        ]}
      >
        <div />
      </ShortcutProvider>,
    )
    await user.keyboard('j')
    expect(onNext).not.toHaveBeenCalled()
  })
})
