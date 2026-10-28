import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RegistryShortcutsDialog,
  ShortcutGroups,
  ShortcutKeys,
  ShortcutsDialog,
} from './shortcuts-dialog'
import { ShortcutProvider, useRegisterShortcuts } from './shortcut-provider'
import { listShortcuts } from '#/lib/shortcut-scopes'
import type { ShortcutDefinition } from '#/lib/shortcuts'

afterEach(cleanup)

const definitions: ShortcutDefinition[] = [
  {
    id: 'palette',
    scope: 'global',
    keys: ['mod+k'],
    description: 'Open the command palette',
  },
  { id: 'next', scope: 'list', keys: ['j'], description: 'Next row' },
]

describe('ShortcutsDialog', () => {
  it('lists registered shortcuts grouped by scope', () => {
    render(
      <ShortcutsDialog open onOpenChange={vi.fn()} definitions={definitions} />,
    )
    expect(screen.getByText('Open the command palette')).toBeTruthy()
    expect(screen.getByText('Next row')).toBeTruthy()
    expect(screen.getByText('Anywhere')).toBeTruthy()
    expect(screen.getByText('Lists')).toBeTruthy()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <ShortcutsDialog
        open={false}
        onOpenChange={vi.fn()}
        definitions={definitions}
      />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps both close controls functional', async () => {
    const change = vi.fn()
    const user = userEvent.setup()
    render(
      <ShortcutsDialog open onOpenChange={change} definitions={definitions} />,
    )
    const close = screen.getAllByRole('button', { name: 'Close' })
    expect(close).toHaveLength(2)
    await user.click(close[1])
    expect(change).toHaveBeenCalledWith(false, expect.anything())
  })
})

describe('registry binding presentation', () => {
  it('distinguishes a sequence from alternative keys and converts modifiers', () => {
    const { rerender, container } = render(
      <ShortcutKeys bindings={['g h']} platform="mac" />,
    )
    expect(container.textContent).toBe('G then H')
    expect(
      [...container.querySelectorAll('kbd')].map((key) => key.textContent),
    ).toEqual(['G', 'H'])
    rerender(
      <ShortcutKeys bindings={['arrowup', 'arrowdown']} platform="mac" />,
    )
    expect(container.textContent).toBe('↑ ↓')
    rerender(<ShortcutKeys bindings={['alt+mod+m']} platform="other" />)
    expect(
      [...container.querySelectorAll('kbd')].map((key) => key.textContent),
    ).toEqual(['Ctrl', 'Alt', 'M'])
  })

  it('labels simultaneous article and dialog groups with distinct ids', () => {
    const { container } = render(
      <>
        <ShortcutGroups definitions={definitions} platform="mac" />
        <ShortcutGroups
          definitions={definitions}
          platform="mac"
          headingLevel={3}
        />
      </>,
    )
    const headings = [...container.querySelectorAll('h2, h3')]
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(4)
    for (const section of container.querySelectorAll('section')) {
      expect(section.querySelector('h2, h3')?.id).toBe(
        section.getAttribute('aria-labelledby'),
      )
    }
  })
})

describe('RegistryShortcutsDialog', () => {
  // A screen passes a stable definition array (useMemo in real screens); a
  // fresh array each render would re-register forever.
  const listDefinitions = listShortcuts({ next: vi.fn(), previous: vi.fn() })

  function ListScene() {
    useRegisterShortcuts(listDefinitions)
    return null
  }

  it('shows shortcuts registered by the mounted screen, not just the shell', () => {
    render(
      <ShortcutProvider definitions={definitions}>
        <ListScene />
        <RegistryShortcutsDialog open onOpenChange={vi.fn()} />
      </ShortcutProvider>,
    )
    expect(screen.getByText('Open the command palette')).toBeTruthy()
    expect(screen.getByText('Next and previous item')).toBeTruthy()
    expect(screen.getByText('Lists')).toBeTruthy()
  })

  it('keeps the complete catalogue when its route unmounts', () => {
    const { rerender } = render(
      <ShortcutProvider definitions={definitions}>
        <ListScene />
        <RegistryShortcutsDialog open onOpenChange={vi.fn()} />
      </ShortcutProvider>,
    )
    expect(screen.getByText('Next and previous item')).toBeTruthy()
    rerender(
      <ShortcutProvider definitions={definitions}>
        <RegistryShortcutsDialog open onOpenChange={vi.fn()} />
      </ShortcutProvider>,
    )
    expect(screen.getByText('Next and previous item')).toBeTruthy()
    expect(screen.getByText('Add to selection')).toBeTruthy()
    expect(screen.getByText('Save the row')).toBeTruthy()
    expect(screen.getByText('Approve and sign…')).toBeTruthy()
  })
})
