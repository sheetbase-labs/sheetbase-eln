import * as React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ShortcutProvider,
  useRegisterShortcuts,
  useShortcutScope,
} from './shortcut-provider'

afterEach(cleanup)

describe('ShortcutProvider', () => {
  it('only enables the active provider and discards a partial sequence on deactivation', () => {
    const first = vi.fn()
    const second = vi.fn()
    const definitions = (handler: () => void) => [
      {
        id: 'home',
        scope: 'global' as const,
        keys: ['g h'],
        description: 'Home',
        handler,
      },
    ]
    function Scene({ firstActive }: { firstActive: boolean }) {
      return (
        <>
          <ShortcutProvider
            definitions={definitions(first)}
            enabled={firstActive}
          >
            <div />
          </ShortcutProvider>
          <ShortcutProvider
            definitions={definitions(second)}
            enabled={!firstActive}
          >
            <div />
          </ShortcutProvider>
        </>
      )
    }
    const app = render(<Scene firstActive />)
    fireEvent.keyDown(window, { key: 'g' })
    app.rerender(<Scene firstActive={false} />)
    fireEvent.keyDown(window, { key: 'h' })
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'h' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

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

  it('suppresses each binding independently of allowed input shortcuts', async () => {
    const user = userEvent.setup()
    const insert = vi.fn()
    const cancel = vi.fn()
    const save = vi.fn()
    function NotebookScene() {
      useShortcutScope('notebook')
      return <textarea aria-label="Cell value" />
    }
    render(
      <ShortcutProvider
        definitions={[
          {
            id: 'notebook-insert-block',
            scope: 'notebook',
            keys: ['/'],
            description: 'Insert',
            handler: insert,
          },
          {
            id: 'notebook-cancel-edit',
            scope: 'notebook',
            keys: ['escape'],
            description: 'Cancel',
            allowInInput: true,
            handler: cancel,
          },
          {
            id: 'notebook-save-row',
            scope: 'notebook',
            keys: ['mod+enter'],
            description: 'Save',
            allowInInput: true,
            handler: save,
          },
        ]}
      >
        <NotebookScene />
      </ShortcutProvider>,
    )
    const field = screen.getByLabelText('Cell value')
    await user.click(field)
    await user.keyboard('/{Escape}')
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(insert).not.toHaveBeenCalled()
    expect(field).toHaveProperty('value', '/')
    expect(cancel).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledOnce()
  })

  it('does not intercept catalogue-only bindings or unavailable actions', () => {
    const handler = vi.fn()
    render(
      <ShortcutProvider
        definitions={[
          {
            id: 'create',
            scope: 'global',
            keys: ['c'],
            description: 'Create',
            handler,
            when: () => false,
          },
        ]}
      >
        <button onKeyDown={(event) => event.preventDefault()}>Control</button>
      </ShortcutProvider>,
    )
    const event = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    fireEvent.keyDown(screen.getByRole('button'), { key: 'c' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not dispatch underlying actions from an open overlay', () => {
    const handler = vi.fn()
    render(
      <ShortcutProvider
        definitions={[
          {
            id: 'create',
            scope: 'global',
            keys: ['c'],
            description: 'Create',
            handler,
          },
        ]}
      >
        <div role="dialog" aria-modal="true">
          <button>Close</button>
        </div>
      </ShortcutProvider>,
    )
    fireEvent.keyDown(screen.getByRole('button'), { key: 'c' })
    expect(handler).not.toHaveBeenCalled()
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
