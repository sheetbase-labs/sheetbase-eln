import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShortcutsDialog } from './shortcuts-dialog'
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
