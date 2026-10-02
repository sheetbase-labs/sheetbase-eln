import { describe, expect, it, vi } from 'vitest'

import { createGlobalShortcuts } from './global-shortcuts'

function makeHandlers() {
  return {
    openPalette: vi.fn(),
    openHelp: vi.fn(),
    toggleRail: vi.fn(),
    navigate: vi.fn(),
    destinations: [
      { key: 'h', to: '/', label: 'Home' },
      { key: 'p', to: '/projects', label: 'Projects' },
    ],
  }
}

function event() {
  return { preventDefault: vi.fn() } as unknown as KeyboardEvent
}

describe('createGlobalShortcuts', () => {
  it('registers the palette, help and rail shortcuts', () => {
    const definitions = createGlobalShortcuts(makeHandlers())
    expect(definitions.map((d) => d.id)).toEqual(
      expect.arrayContaining(['palette', 'help', 'toggle-rail']),
    )
    expect(definitions.find((d) => d.id === 'palette')?.keys).toEqual(['mod+k'])
    expect(definitions.find((d) => d.id === 'help')?.keys).toEqual(['?'])
  })

  it('invokes the palette handler and prevents default', () => {
    const handlers = makeHandlers()
    const definitions = createGlobalShortcuts(handlers)
    const e = event()
    definitions.find((d) => d.id === 'palette')?.handler?.(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(handlers.openPalette).toHaveBeenCalledOnce()
  })

  it('generates a g-sequence shortcut per destination', () => {
    const handlers = makeHandlers()
    const definitions = createGlobalShortcuts(handlers)
    const projectShortcut = definitions.find((d) => d.id === 'go-p')
    expect(projectShortcut?.keys).toEqual(['g p'])
    projectShortcut?.handler?.(event())
    expect(handlers.navigate).toHaveBeenCalledWith('/projects')
  })

  it('opens help and toggles the rail', () => {
    const handlers = makeHandlers()
    const definitions = createGlobalShortcuts(handlers)
    definitions.find((d) => d.id === 'help')?.handler?.(event())
    definitions.find((d) => d.id === 'toggle-rail')?.handler?.(event())
    expect(handlers.openHelp).toHaveBeenCalledOnce()
    expect(handlers.toggleRail).toHaveBeenCalledOnce()
  })

  it('adds the Create shortcut only when the shell can open Create', () => {
    expect(
      createGlobalShortcuts(makeHandlers()).some((d) => d.id === 'create'),
    ).toBe(false)

    const openCreate = vi.fn()
    const definitions = createGlobalShortcuts({
      ...makeHandlers(),
      openCreate,
    })
    const create = definitions.find((d) => d.id === 'create')
    expect(create?.keys).toEqual(['c'])
    create?.handler?.(event())
    expect(openCreate).toHaveBeenCalledOnce()
  })
})
