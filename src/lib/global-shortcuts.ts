import type { ShortcutDefinition } from '#/lib/shortcuts'

export interface GlobalShortcutDestination {
  key: string
  to: string
  label: string
}

/**
 * The global shortcuts (SHELL-03). Handlers and destinations are injected so
 * the catalogue is testable and the shell owns navigation and dialog state.
 */
export interface GlobalShortcutHandlers {
  openPalette: () => void
  openHelp: () => void
  toggleRail: () => void
  navigate: (to: string) => void
  destinations: GlobalShortcutDestination[]
  /** Optional: opens the shell's Create menu (the design's `C`). */
  openCreate?: () => void
}

export function createGlobalShortcuts(
  handlers: GlobalShortcutHandlers,
): ShortcutDefinition[] {
  const navigation = handlers.destinations.map<ShortcutDefinition>(
    (destination) => ({
      id: `go-${destination.key}`,
      scope: 'global',
      keys: [`g ${destination.key}`],
      description: `Go to ${destination.label}`,
      handler: () => handlers.navigate(destination.to),
    }),
  )

  return [
    {
      id: 'palette',
      scope: 'global',
      keys: ['mod+k'],
      description: 'Open the command palette',
      handler: (event) => {
        event.preventDefault()
        handlers.openPalette()
      },
    },
    ...(handlers.openCreate
      ? [
          {
            id: 'create',
            scope: 'global' as const,
            keys: ['c'],
            description: 'Create…',
            handler: (event: KeyboardEvent) => {
              event.preventDefault()
              handlers.openCreate?.()
            },
          },
        ]
      : []),
    {
      id: 'help',
      scope: 'global',
      keys: ['?'],
      description: 'Show keyboard shortcuts',
      handler: (event) => {
        event.preventDefault()
        handlers.openHelp()
      },
    },
    {
      id: 'toggle-rail',
      scope: 'global',
      keys: ['mod+\\'],
      description: 'Collapse or expand navigation',
      handler: (event) => {
        event.preventDefault()
        handlers.toggleRail()
      },
    },
    ...navigation,
  ]
}
