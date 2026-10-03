/**
 * Keyboard shortcut registry (SHELL-03). One place defines every shortcut;
 * the provider installs a single keydown listener and routes events through
 * this module. Pure functions here (matching, sequences, suppression,
 * formatting) are unit-tested; the provider is a thin shell around them.
 *
 * Keys are written the way the design lists them:
 *   'mod+k'      ⌘K on macOS, Ctrl+K elsewhere
 *   'g h'        a sequence: G then H
 *   '?'          a single character, no modifiers
 *   'mod+\'      the navigation rail toggle
 *   'space'      the space bar (never a literal space — that would read as a
 *                sequence separator)
 *   'arrowup'    named keys, aliased the way the design spells them
 */

export type ShortcutScope = 'global' | 'list' | 'notebook' | 'review'
export type Platform = 'mac' | 'other'

export interface ShortcutDefinition {
  id: string
  scope: ShortcutScope
  /** One or more bindings; the first is shown in help. */
  keys: string[]
  description: string
  /** Fire even while a text input or contenteditable is focused. */
  allowInInput?: boolean
  /** Invoked when the binding (or completed sequence) fires. */
  handler?: (event: KeyboardEvent) => void
}

interface ParsedBinding {
  key: string
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/**
 * The design writes several keys as short words or glyphs. Bindings use the
 * canonical `KeyboardEvent.key` name (or a readable shorthand) and these maps
 * translate both ways, so `'space'` matches `event.key === ' '` and formats as
 * the design's `Space`.
 */
const KEY_ALIASES: Record<string, string> = {
  space: ' ',
  spacebar: ' ',
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
}

const KEY_LABELS: Record<string, string | undefined> = {
  ' ': 'Space',
  escape: 'Esc',
  enter: '↵',
  tab: 'Tab',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: '⌫',
  delete: 'Del',
}

export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
    ? 'mac'
    : 'other'
}

export function parseBinding(
  binding: string,
  platform: Platform,
): ParsedBinding {
  const parts = binding.split('+')
  const rawKey = parts.pop() ?? ''
  const key = KEY_ALIASES[rawKey.toLowerCase()] ?? rawKey
  const parsed: ParsedBinding = {
    key,
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
  }
  for (const part of parts) {
    const token = part.toLowerCase()
    if (token === 'mod') {
      if (platform === 'mac') parsed.meta = true
      else parsed.ctrl = true
    } else if (token === 'meta' || token === 'cmd') parsed.meta = true
    else if (token === 'ctrl') parsed.ctrl = true
    else if (token === 'alt' || token === 'option') parsed.alt = true
    else if (token === 'shift') parsed.shift = true
  }
  return parsed
}

export function bindingMatches(
  event: KeyboardEvent,
  binding: string,
  platform: Platform,
): boolean {
  const parsed = parseBinding(binding, platform)
  // A binding with no modifier tokens matches its key with or without Shift:
  // the design's `?` is Shift+/ on most layouts, and `C` (Create) must fire
  // for an uppercase C. Any declared modifier makes the Shift state exact.
  const hasModifiers = parsed.meta || parsed.ctrl || parsed.alt || parsed.shift
  const shiftMatches = hasModifiers ? event.shiftKey === parsed.shift : true
  return (
    event.key.toLowerCase() === parsed.key.toLowerCase() &&
    event.metaKey === parsed.meta &&
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    shiftMatches
  )
}

/** Split a sequence like `g h` into its steps. */
export function sequenceSteps(sequence: string): string[] {
  return sequence.trim().split(/\s+/).filter(Boolean)
}

/** Match one step of a sequence (no modifiers, usually a single character). */
export function stepMatches(
  event: KeyboardEvent,
  step: string,
  platform: Platform,
): boolean {
  return bindingMatches(event, step, platform)
}

/** Should a shortcut be suppressed because the user is typing? */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (
    target.isContentEditable ||
    target.getAttribute('contenteditable') === 'true' ||
    target.getAttribute('contenteditable') === ''
  )
    return true
  const tag = target.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag === 'input') {
    const type = (target as HTMLInputElement).type
    return !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type)
  }
  return false
}

/** Human-readable label for the shortcuts dialog. */
export function formatShortcut(binding: string, platform: Platform): string {
  // A sequence reads "G then H", matching the design's wording.
  const steps = sequenceSteps(binding)
  if (steps.length > 1) {
    return steps.map((step) => formatShortcut(step, platform)).join(' then ')
  }
  const parsed = parseBinding(binding, platform)
  const parts: string[] = []
  if (parsed.meta) parts.push('⌘')
  if (parsed.ctrl) parts.push('Ctrl')
  if (parsed.alt) parts.push('⌥')
  if (parsed.shift) parts.push('⇧')
  const label = KEY_LABELS[parsed.key]
  const key = label ?? (parsed.key === '\\' ? '\\' : parsed.key.toUpperCase())
  parts.push(key)
  return platform === 'mac' ? parts.join('') : parts.join('+')
}

export interface ShortcutRegistry {
  definitions: ShortcutDefinition[]
  /** Definitions in a scope, in registration order. */
  inScope: (scope: ShortcutScope) => ShortcutDefinition[]
  /** Match a single, complete binding (no sequence). */
  match: (
    event: KeyboardEvent,
    scope: ShortcutScope,
    platform: Platform,
  ) => ShortcutDefinition | undefined
}

export function createShortcutRegistry(
  definitions: ShortcutDefinition[],
): ShortcutRegistry {
  const seen = new Set<string>()
  for (const definition of definitions) {
    if (seen.has(definition.id))
      throw new Error(`Duplicate shortcut id: ${definition.id}`)
    seen.add(definition.id)
  }
  return {
    definitions,
    inScope: (scope) => definitions.filter((d) => d.scope === scope),
    match: (event, scope, platform) =>
      definitions.find(
        (definition) =>
          (definition.scope === scope || definition.scope === 'global') &&
          definition.keys.some(
            (binding) =>
              !binding.includes(' ') &&
              bindingMatches(event, binding, platform),
          ),
      ),
  }
}
