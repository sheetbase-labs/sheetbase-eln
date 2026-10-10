'use client'

import * as React from 'react'

import type { IconName } from '#/components/icons'

import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'

/**
 * The application shell contract (SHELL-01). Routes call `useShell()` to set
 * their breadcrumbs, inspector, primary action and other per-route slots; the
 * shell renders once at the root and persists across navigation. Keeping this
 * contract stable lets the shell chrome be rebuilt without touching routes.
 */

export const APP_SHELL_MAIN_ID = 'app-shell-main'
export const APP_SHELL_NAV_ID = 'app-shell-nav'

export interface AppShellBreadcrumb {
  label: string
  to?: string
}

export interface AppShellNavItem {
  to: string
  label: string
  icon: IconName
  badge?: string | number
  disabled?: boolean
}

export interface AppShellNavSection {
  label?: string
  items: AppShellNavItem[]
}

export interface AppShellWorkspace {
  id?: string
  slug?: string
  name: string
}

export interface AppShellUser {
  name: string
  email: string
  role?: string
}

export interface AppShellContext {
  workspace: AppShellWorkspace | null
  /** Every workspace the user belongs to (SHELL-01.4 switcher). */
  workspaces?: AppShellWorkspace[]
  user: AppShellUser
}

/** Per-route shell configuration set via useShell(). */
export interface ShellConfig {
  context: AppShellContext | null
  breadcrumbs: AppShellBreadcrumb[]
  /** Page header slots (SHELL-01.3). */
  title?: React.ReactNode
  status?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
  inspector?: React.ReactNode
  inspectorLabel?: string
  inspectorCollapsible?: boolean
  fullBleed?: boolean
  primaryAction?: React.ReactNode
  projectTree?: React.ReactNode
  navExtra?: React.ReactNode
  /**
   * EXT-02: resolved palette commands for the current route. Rendered as
   * an additive "Extensions" group in the ⌘K palette (absent while empty).
   */
  extensionCommands?: ResolvedExtensionContribution[]
  onExtensionCommand?: (command: ResolvedExtensionContribution) => void
}

export const ShellContext = React.createContext<{
  setConfig: (c: Partial<ShellConfig>) => void
}>({ setConfig: () => {} })

/**
 * Memoized wrapper that provides the stable `setConfig` via context and
 * renders children. Because it is memoized and `setConfig` is stable, React
 * skips re-rendering this subtree when the parent provider updates its config
 * state — only the shell itself re-renders. This breaks the feedback loop
 * where a config update → provider re-render → route re-render → useShell.
 */
export const ShellContent = React.memo(function ShellContentView({
  children,
  setConfig,
}: {
  children: React.ReactNode
  setConfig: (c: Partial<ShellConfig>) => void
}) {
  return (
    <ShellContext.Provider value={{ setConfig }}>
      {children}
    </ShellContext.Provider>
  )
})

/**
 * Hook called by each route to set its per-route shell configuration. Uses
 * useLayoutEffect so the shell updates synchronously before paint, avoiding
 * flashes, and only calls `setConfig` when a field actually changed.
 */
export function useShell(config: Partial<ShellConfig>) {
  const { setConfig } = React.useContext(ShellContext)
  const prevRef = React.useRef<Partial<ShellConfig> | undefined>(undefined)

  React.useLayoutEffect(() => {
    const prev = prevRef.current
    if (prev !== undefined) {
      let changed = false
      for (const key of Object.keys(config) as (keyof ShellConfig)[]) {
        if (config[key] !== prev[key]) {
          changed = true
          break
        }
      }
      if (!changed) return
    }
    prevRef.current = config
    setConfig(config)
  })

  // Clear per-route shell slots on unmount. useLayoutEffect (not useEffect) so
  // the cleanup runs before the next route's useLayoutEffect sets its config.
  React.useLayoutEffect(() => {
    return () => {
      prevRef.current = undefined
      setConfig({
        inspector: undefined,
        inspectorLabel: undefined,
        inspectorCollapsible: undefined,
        fullBleed: undefined,
        primaryAction: undefined,
        title: undefined,
        status: undefined,
        actions: undefined,
        tabs: undefined,
        projectTree: undefined,
        navExtra: undefined,
        extensionCommands: undefined,
        onExtensionCommand: undefined,
        breadcrumbs: [],
      })
    }
  }, [])
}
