import { describe, expect, it } from 'vitest'

import {
  bindingMatches,
  createShortcutRegistry,
  formatShortcut,
  isEditableTarget,
  parseBinding,
  sequenceSteps,
} from './shortcuts'
import type { ShortcutDefinition } from './shortcuts'

function key(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', init)
}

describe('parseBinding', () => {
  it('maps mod to ⌘ on macOS and Ctrl elsewhere', () => {
    expect(parseBinding('mod+k', 'mac')).toMatchObject({ key: 'k', meta: true })
    expect(parseBinding('mod+k', 'other')).toMatchObject({
      key: 'k',
      ctrl: true,
    })
  })

  it('parses shift, alt and a bare key', () => {
    expect(parseBinding('shift+enter', 'mac')).toMatchObject({
      key: 'enter',
      shift: true,
    })
    expect(parseBinding('?', 'mac')).toMatchObject({ key: '?' })
  })

  it('aliases the design’s named keys to KeyboardEvent.key values', () => {
    expect(parseBinding('space', 'mac')).toMatchObject({ key: ' ' })
    expect(parseBinding('esc', 'mac')).toMatchObject({ key: 'escape' })
    expect(parseBinding('arrowup', 'mac')).toMatchObject({ key: 'arrowup' })
  })
})

describe('bindingMatches', () => {
  it('matches ⌘K on macOS', () => {
    expect(
      bindingMatches(key({ key: 'k', metaKey: true }), 'mod+k', 'mac'),
    ).toBe(true)
    expect(bindingMatches(key({ key: 'k' }), 'mod+k', 'mac')).toBe(false)
  })

  it('matches Ctrl+K on other platforms', () => {
    expect(
      bindingMatches(key({ key: 'k', ctrlKey: true }), 'mod+k', 'other'),
    ).toBe(true)
    expect(
      bindingMatches(key({ key: 'k', metaKey: true }), 'mod+k', 'other'),
    ).toBe(false)
  })

  it('matches a bare key with or without Shift', () => {
    // The design's `?` is Shift+/ on most layouts.
    expect(bindingMatches(key({ key: '?', shiftKey: true }), '?', 'mac')).toBe(
      true,
    )
    expect(bindingMatches(key({ key: 'c', shiftKey: true }), 'c', 'mac')).toBe(
      true,
    )
    // `space` is the alias for the space bar, never a sequence separator.
    expect(bindingMatches(key({ key: ' ' }), 'space', 'mac')).toBe(true)
    // A declared modifier still pins the Shift state exactly.
    expect(
      bindingMatches(
        key({ key: 'Enter', metaKey: true, shiftKey: true }),
        'mod+enter',
        'mac',
      ),
    ).toBe(false)
  })
})

describe('sequenceSteps', () => {
  it('splits a sequence on spaces', () => {
    expect(sequenceSteps('g h')).toEqual(['g', 'h'])
    expect(sequenceSteps('  mod+k  ')).toEqual(['mod+k'])
  })
})

describe('isEditableTarget', () => {
  it('detects text inputs, textareas and contenteditable', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(textarea)).toBe(true)
    expect(isEditableTarget(editable)).toBe(true)
  })

  it('does not treat a checkbox or a button as editable', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(isEditableTarget(checkbox)).toBe(false)
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
  })
})

describe('formatShortcut', () => {
  it('uses glyphs on macOS and words elsewhere', () => {
    expect(formatShortcut('mod+k', 'mac')).toBe('⌘K')
    expect(formatShortcut('mod+k', 'other')).toBe('Ctrl+K')
    expect(formatShortcut('mod+shift+enter', 'mac')).toBe('⌘⇧↵')
  })

  it('spells the design’s named keys', () => {
    expect(formatShortcut('space', 'mac')).toBe('Space')
    expect(formatShortcut('escape', 'mac')).toBe('Esc')
    expect(formatShortcut('arrowup', 'mac')).toBe('↑')
    expect(formatShortcut('arrowdown', 'mac')).toBe('↓')
    expect(formatShortcut('tab', 'mac')).toBe('Tab')
  })

  it('reads a sequence as “G then H”', () => {
    expect(formatShortcut('g h', 'mac')).toBe('G then H')
  })
})

describe('createShortcutRegistry', () => {
  const definitions: ShortcutDefinition[] = [
    { id: 'palette', scope: 'global', keys: ['mod+k'], description: 'Search' },
    { id: 'home', scope: 'global', keys: ['g h'], description: 'Go home' },
    { id: 'next', scope: 'list', keys: ['j'], description: 'Next row' },
  ]

  it('rejects duplicate ids', () => {
    expect(() =>
      createShortcutRegistry([
        ...definitions,
        { id: 'palette', scope: 'global', keys: ['mod+p'], description: 'x' },
      ]),
    ).toThrow(/Duplicate shortcut id/)
  })

  it('lists definitions in a scope', () => {
    const registry = createShortcutRegistry(definitions)
    expect(registry.inScope('list').map((d) => d.id)).toEqual(['next'])
    expect(registry.inScope('notebook')).toEqual([])
  })

  it('matches single bindings in the active scope and global', () => {
    const registry = createShortcutRegistry(definitions)
    expect(
      registry.match(key({ key: 'k', metaKey: true }), 'list', 'mac')?.id,
    ).toBe('palette')
    expect(registry.match(key({ key: 'j' }), 'list', 'mac')?.id).toBe('next')
    expect(registry.match(key({ key: 'j' }), 'global', 'mac')).toBeUndefined()
  })

  it('does not match multi-step sequences as single bindings', () => {
    const registry = createShortcutRegistry(definitions)
    expect(registry.match(key({ key: 'g' }), 'global', 'mac')).toBeUndefined()
  })
})
