import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RegistryShortcutsDialog, ShortcutsDialog } from './shortcuts-dialog'
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

  it('drops a scoped shortcut when its screen unmounts', () => {
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
    expect(screen.queryByText('Next and previous item')).toBeNull()
  })
})
