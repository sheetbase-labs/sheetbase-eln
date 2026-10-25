import * as React from 'react'

import {
  createShortcutRegistry,
  appliesIn,
  currentPlatform,
  isEditableTarget,
  sequenceSteps,
  stepMatches,
} from '#/lib/shortcuts'
import type { ShortcutDefinition, ShortcutScope } from '#/lib/shortcuts'
import { SCOPED_SHORTCUTS } from '#/lib/shortcut-scopes'

interface ShortcutContextValue {
  scope: ShortcutScope
  registerScope: (id: string, scope: ShortcutScope) => () => void
  registry: ReturnType<typeof createShortcutRegistry>
  /** Register route-scoped definitions; returns an unregister function. */
  register: (id: string, definitions: ShortcutDefinition[]) => () => void
}

const ShortcutContext = React.createContext<ShortcutContextValue | null>(null)

const SEQUENCE_TIMEOUT_MS = 1500

/**
 * Single keydown listener for the whole app (SHELL-03). Shortcuts are matched
 * in the active scope (plus `global`); sequences like `g h` buffer for a short
 * time. Shortcuts are suppressed inside text inputs and contenteditable unless
 * the definition sets `allowInInput`.
 */
export function ShortcutProvider({
  definitions,
  children,
  enabled = true,
}: {
  definitions: ShortcutDefinition[]
  children: React.ReactNode
  enabled?: boolean
}) {
  const [scopes, setScopes] = React.useState<Record<string, ShortcutScope>>({})
  const scope = Object.values(scopes).at(-1) ?? 'global'
  const registerScope = React.useCallback(
    (id: string, registeredScope: ShortcutScope) => {
      setScopes((current) => ({ ...current, [id]: registeredScope }))
      return () =>
        setScopes((current) => {
          const next = { ...current }
          delete next[id]
          return next
        })
    },
    [],
  )
  // Route-scoped definitions (SHELL-03.3): screens register their list,
  // notebook and review shortcuts while they are mounted.
  const [scoped, setScoped] = React.useState<
    Record<string, ShortcutDefinition[]>
  >({})
  const register = React.useCallback(
    (id: string, registrations: ShortcutDefinition[]) => {
      setScoped((current) =>
        current[id] === registrations
          ? current
          : { ...current, [id]: registrations },
      )
      return () => {
        setScoped((current) => {
          if (!(id in current)) return current
          const next = { ...current }
          delete next[id]
          return next
        })
      }
    },
    [],
  )
  // A nested provider (a workspace pane) listens only for its own keys, but
  // still lists the enclosing app's shortcuts so help pages and the shortcuts
  // dialog read the same inside a pane.
  const parent = React.useContext(ShortcutContext)
  const inherited = parent?.registry.definitions
  const allDefinitions = React.useMemo(() => {
    const entries = new Map(
      [
        ...(inherited ?? []),
        ...definitions,
        ...SCOPED_SHORTCUTS.filter(
          (item) =>
            !definitions.some((definition) => definition.id === item.id),
        ),
      ].map((definition) => [definition.id, definition]),
    )
    for (const definition of Object.values(scoped).flat()) {
      entries.set(definition.id, definition)
    }
    return [...entries.values()]
  }, [definitions, scoped, inherited])
  const registry = React.useMemo(
    () => createShortcutRegistry(allDefinitions),
    [allDefinitions],
  )
  const pending = React.useRef<{ steps: string[]; index: number }>({
    steps: [],
    index: 0,
  })
  const timer = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!enabled) return
    const platform = currentPlatform()

    function clearPending() {
      pending.current = { steps: [], index: 0 }
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      // Modal primitives own overlay keys, especially Escape. Capture gives
      // the registered grid actions priority over the engine's different
      // Enter behaviour; unregistered keys continue to the control normally.
      if (
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector(
          '[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"]',
        )
      ) {
        clearPending()
        return
      }
      const editable = isEditableTarget(event.target)
      const active = [...definitions, ...Object.values(scoped).flat()].filter(
        (definition) =>
          definition.handler &&
          appliesIn(definition, scope) &&
          (!editable || definition.allowInInput) &&
          (!definition.when || definition.when(event)),
      )
      if (active.length === 0) {
        clearPending()
        return
      }

      // Continue a sequence in progress.
      if (pending.current.steps.length > 0) {
        const next = pending.current.index
        const candidates = active.filter((definition) =>
          definition.keys.some((key) => {
            const steps = sequenceSteps(key)
            return (
              steps.length > pending.current.steps.length &&
              steps
                .slice(0, pending.current.steps.length)
                .every(
                  (step, i) =>
                    step.toLowerCase() ===
                    pending.current.steps[i].toLowerCase(),
                ) &&
              stepMatches(event, steps[next] ?? '', platform)
            )
          }),
        )
        if (candidates.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          const completed = candidates.find((definition) =>
            definition.keys.some(
              (key) =>
                sequenceSteps(key).length === pending.current.steps.length + 1,
            ),
          )
          if (completed) {
            clearPending()
            completed.handler?.(event)
          } else {
            pending.current.steps.push(event.key)
            pending.current.index += 1
            timer.current = window.setTimeout(clearPending, SEQUENCE_TIMEOUT_MS)
          }
          return
        }
        clearPending()
      }

      // Single-binding shortcuts.
      const match = active.find((definition) =>
        definition.keys.some(
          (key) => !key.includes(' ') && stepMatches(event, key, platform),
        ),
      )
      if (match) {
        event.preventDefault()
        event.stopPropagation()
        match.handler?.(event)
        return
      }

      // Start a sequence.
      const starts = active.filter((definition) =>
        definition.keys.some((key) => {
          const steps = sequenceSteps(key)
          return steps.length > 1 && stepMatches(event, steps[0], platform)
        }),
      )
      if (starts.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        pending.current = { steps: [event.key], index: 1 }
        timer.current = window.setTimeout(clearPending, SEQUENCE_TIMEOUT_MS)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      clearPending()
    }
  }, [definitions, scoped, scope, enabled])

  const value = React.useMemo<ShortcutContextValue>(
    () => ({ scope, registerScope, registry, register }),
    [scope, registerScope, registry, register],
  )
  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  )
}

export function useShortcutScope(scope: ShortcutScope) {
  const context = React.useContext(ShortcutContext)
  const registerScope = context?.registerScope
  const id = React.useId()
  React.useEffect(() => {
    if (!registerScope) return
    return registerScope(id, scope)
  }, [registerScope, id, scope])
}

/**
 * Registers route-scoped shortcuts (SHELL-03.3) for as long as the calling
 * component is mounted. Pass a `useMemo`-stable array; the definitions are
 * merged into the active scope by the single provider listener.
 */
export function useRegisterShortcuts(definitions: ShortcutDefinition[]) {
  const context = React.useContext(ShortcutContext)
  const register = context?.register
  const id = React.useId()
  React.useEffect(() => {
    if (!register) return
    return register(id, definitions)
  }, [register, id, definitions])
}

export function useShortcuts() {
  const context = React.useContext(ShortcutContext)
  if (!context)
    throw new Error('useShortcuts must be used within ShortcutProvider')
  return context
}
