import * as React from 'react'

import {
  createShortcutRegistry,
  currentPlatform,
  isEditableTarget,
  sequenceSteps,
  stepMatches,
} from '#/lib/shortcuts'
import type { ShortcutDefinition, ShortcutScope } from '#/lib/shortcuts'

interface ShortcutContextValue {
  scope: ShortcutScope
  setScope: (scope: ShortcutScope) => void
  registry: ReturnType<typeof createShortcutRegistry>
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
}: {
  definitions: ShortcutDefinition[]
  children: React.ReactNode
}) {
  const [scope, setScope] = React.useState<ShortcutScope>('global')
  const registry = React.useMemo(
    () => createShortcutRegistry(definitions),
    [definitions],
  )
  const pending = React.useRef<{ steps: string[]; index: number }>({
    steps: [],
    index: 0,
  })
  const timer = React.useRef<number | null>(null)

  React.useEffect(() => {
    const platform = currentPlatform()

    function clearPending() {
      pending.current = { steps: [], index: 0 }
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      const editable = isEditableTarget(event.target)
      const active = registry.definitions.filter(
        (definition) =>
          definition.scope === scope || definition.scope === 'global',
      )
      if (editable && active.every((definition) => !definition.allowInInput)) {
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
        pending.current = { steps: [event.key], index: 1 }
        timer.current = window.setTimeout(clearPending, SEQUENCE_TIMEOUT_MS)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      clearPending()
    }
  }, [registry, scope])

  const value = React.useMemo<ShortcutContextValue>(
    () => ({ scope, setScope, registry }),
    [scope, registry],
  )
  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  )
}

export function useShortcutScope(scope: ShortcutScope) {
  const context = React.useContext(ShortcutContext)
  React.useEffect(() => {
    if (!context) return
    context.setScope(scope)
    return () => context.setScope('global')
  }, [context, scope])
}

export function useShortcuts() {
  const context = React.useContext(ShortcutContext)
  if (!context)
    throw new Error('useShortcuts must be used within ShortcutProvider')
  return context
}
