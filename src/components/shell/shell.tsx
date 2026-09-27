// @vitest-environment jsdom
'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import {
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Database,
  FlaskConical,
  FolderOpen,
  GanttChart,
  Home as HomeIcon,
  Layers,
  LayoutTemplate,
  LineChart as LineChartIcon,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Search,
  Settings,
  Star,
  Sun,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { authClient } from '#/lib/auth-client'
import {
  fetchFavouriteItems,
  favouritesQueryKeys,
  FAVOURITES_LIMIT,
} from '#/lib/favourites'
import type { FavouriteItem } from '#/lib/favourites'
import { ExtensionCommandGroup } from '#/components/extensions/extension-slots'
import type { ResolvedExtensionContribution } from '#/lib/extensions/registry'
import { notebookDataClient, notebookQueryKeys } from '#/lib/notebook-data'
import type { ProjectWire } from '#/lib/notebook-data'
import { projectPath } from '#/lib/navigation'
import { cn } from '#/lib/utils'
import { useTheme } from '#/components/theme-provider'
import { createGlobalShortcuts } from '#/lib/global-shortcuts'
import type { GlobalShortcutDestination } from '#/lib/global-shortcuts'
import { ShortcutProvider } from '../shortcuts/shortcut-provider'
import { ShortcutsDialog } from '../shortcuts/shortcuts-dialog'
import { PageHeader } from './page-header'
import { createDataClient } from '#/lib/data-client'
import { listRecentPipelineRuns } from '#/lib/pipelines/data'
import { setActiveWorkspace } from '#/lib/user-preferences'
import { TopBarActions } from './top-bar'
import { ShellInspector, ShellInspectorSheet } from './inspector'
import {
  ShellContent,
  APP_SHELL_MAIN_ID,
  APP_SHELL_NAV_ID,
} from './shell-context'
import type {
  AppShellBreadcrumb,
  AppShellNavItem,
  AppShellNavSection,
  AppShellContext,
  ShellConfig,
} from './shell-context'
import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui'

/**
 * Application shell — the stable chrome that wraps every authenticated
 * product route. See `docs/knowledge/decisions/0009-application-shell.md`.
 *
 * Layout (from the Sheetbase ELN mockups):
 *   ┌─────────┬───────────────────────────────┬──────────┐
 *   │ sidebar │ top bar (breadcrumbs · search)│ inspector│
 *   │ (240px) │ main work area ……………………      │ (320px)  │
 *   │         │                               │ optional │
 *   └─────────┴───────────────────────────────┴──────────┘
 *
 * - The sidebar is fixed-width on desktop and collapses to an icon rail
 *   without losing the active workspace/project context (breadcrumbs
 *   preserve it). On narrow screens it becomes a Sheet.
 * - The right inspector is an optional slot. On narrow screens it converts
 *   to a Sheet triggered from the top bar.
 * - A command palette (⌘K) provides keyboard navigation and quick actions.
 * - Public routes (`/sign-in`, `/foundations`) do not use this chrome.
 */

const COLLAPSE_KEY = 'sheetbase-sidebar-collapsed'
const INSPECTOR_COLLAPSE_KEY = 'sheetbase-inspector-collapsed'

// NAV-03: `g`-then-letter keyboard navigation, registered through the
// SHELL-03 shortcut registry (see createGlobalShortcuts).
const G_SEQUENCE_DESTINATIONS: GlobalShortcutDestination[] = [
  { key: 'h', to: '/', label: 'Home' },
  { key: 'p', to: '/projects', label: 'Projects' },
  { key: 'd', to: '/datasets', label: 'Datasets' },
  { key: 's', to: '/sheets', label: 'Sheets' },
  { key: 't', to: '/templates', label: 'Templates' },
  { key: 'a', to: '/samples', label: 'Samples' },
  { key: 'r', to: '/reagents', label: 'Reagents' },
]

/**
 * NAV-03: restore focus to the element that was focused before an overlay
 * opened. Call the returned `capture` synchronously from the open trigger
 * (click/keydown handler, before the overlay steals focus); when `open`
 * flips back to false the captured element is re-focused if still mounted.
 */
function useFocusRestore(open: boolean): () => void {
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const capture = React.useCallback(() => {
    triggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
  }, [])
  React.useEffect(() => {
    if (!open) {
      const el = triggerRef.current
      triggerRef.current = null
      if (el && document.contains(el)) el.focus()
    }
  }, [open])
  return capture
}
// The shell context, its types and the useShell() hook live in
// ./shell/shell-context so the chrome can be rebuilt without changing the
// contract routes depend on.
export { APP_SHELL_MAIN_ID, APP_SHELL_NAV_ID }
export { useShell } from './shell-context'
export type {
  AppShellBreadcrumb,
  AppShellNavItem,
  AppShellNavSection,
  AppShellWorkspace,
  AppShellUser,
  AppShellContext,
  ShellConfig,
} from './shell-context'

/**
 * Render <AppShell> once for the whole session.  When no auth context has
 * been set (public routes, initial load), children render bare — matching
 * the previous behaviour where sign-in/foundations did not use the shell.
 *
 * `initialContext` is passed from the root route so the sidebar renders
 * during SSR — without it the sidebar only appears after hydration when
 * useShell's useLayoutEffect fires, causing a multi-second delay.
 */
export function ShellProvider({
  children,
  initialContext,
}: {
  children: React.ReactNode
  initialContext?: AppShellContext | null
}) {
  const [config, setConfigState] = React.useState<ShellConfig>({
    context: initialContext ?? null,
    breadcrumbs: [],
  })

  const setConfig = React.useCallback(
    (c: Partial<ShellConfig>) =>
      setConfigState((prev) => {
        // Shallow-merge and bail out when nothing actually changed so
        // repeated setConfig calls with equivalent values don't trigger
        // a needless AppShell re-render.
        let changed = false
        for (const key of Object.keys(c) as (keyof ShellConfig)[]) {
          if (c[key] !== prev[key]) {
            changed = true
            break
          }
        }
        return changed ? { ...prev, ...c } : prev
      }),
    [],
  )

  // `content` is memoized via ShellContent — config state updates
  // re-render AppShell but NOT the route children inside.
  // Always render AppShell (even when context is null) to keep the tree
  // structure stable — AppShell returns bare children when context is null.
  return (
    <AppShell
      context={config.context}
      breadcrumbs={config.breadcrumbs}
      inspector={config.inspector}
      inspectorLabel={config.inspectorLabel}
      inspectorCollapsible={config.inspectorCollapsible}
      fullBleed={config.fullBleed}
      primaryAction={config.primaryAction}
      title={config.title}
      status={config.status}
      actions={config.actions}
      tabs={config.tabs}
      projectTree={config.projectTree}
      navExtra={config.navExtra}
      extensionCommands={config.extensionCommands}
      onExtensionCommand={config.onExtensionCommand}
    >
      <ShellContent setConfig={setConfig}>{children}</ShellContent>
    </AppShell>
  )
}

export interface AppShellProps {
  context: AppShellContext | null
  breadcrumbs: AppShellBreadcrumb[]
  /**
   * EXT-02: resolved palette commands for the ⌘K "Extensions" group.
   * Routes set these via `useShell`; the group is absent while empty.
   */
  extensionCommands?: ResolvedExtensionContribution[]
  onExtensionCommand?: (command: ResolvedExtensionContribution) => void
  navSections?: AppShellNavSection[]
  /** Active-project tree slot rendered under a CURRENT PROJECT heading. */
  projectTree?: React.ReactNode
  /** Optional VIEWS/saved-filters slot rendered after the project tree. */
  navExtra?: React.ReactNode
  /** Primary action rendered in the top bar (e.g. + New). */
  primaryAction?: React.ReactNode
  /** Page header slots (SHELL-01.3). */
  title?: React.ReactNode
  status?: React.ReactNode
  actions?: React.ReactNode
  tabs?: React.ReactNode
  /** Optional right-inspector content. When omitted no inspector renders. */
  inspector?: React.ReactNode
  inspectorLabel?: string
  /**
   * When true, the desktop (xl+) inspector gets a collapse/expand toggle in
   * the top bar (PanelRight icon) and remembers its state across reloads via
   * localStorage. The narrow-screen Sheet behaviour is unchanged. Opt in per
   * route; routes that do not set this keep the always-visible inspector.
   */
  inspectorCollapsible?: boolean
  /**
   * When true, children render directly in `<main>` with no max-width
   * wrapper or padding, and the shell constrains to exactly viewport
   * height with `overflow-hidden`. Use for full-viewport dashboard routes
   * (e.g. the schema builder canvas) that manage their own internal
   * scrolling and layout.
   */
  fullBleed?: boolean
  children: React.ReactNode
}

/** Default workspace navigation shared by every authenticated route. */
/** Specialist tools kept reachable but out of the default product nav. */
export const SPECIALIST_NAV_HREFS = [
  '/plate-designer',
  '/calendar',
  '/planner',
  '/instrument-monitor',
  '/storage',
] as const

export const defaultNavSections: AppShellNavSection[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: HomeIcon },
      { to: '/projects', label: 'Projects', icon: FolderOpen },
      { to: '/search', label: 'Search', icon: Search },
    ],
  },
  {
    label: 'Scientific work',
    items: [
      { to: '/samples', label: 'Samples', icon: FlaskConical },
      { to: '/reagents', label: 'Reagents', icon: FlaskConical },
      { to: '/datasets', label: 'Datasets', icon: Database },
      { to: '/analysis', label: 'Analysis', icon: LineChartIcon },
      {
        to: '/reviews',
        label: 'Reviews',
        icon: CheckCircle2,
        badge: 0,
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/templates', label: 'Templates', icon: LayoutTemplate },
      { to: '/configure', label: 'Models & schemas', icon: Layers },
    ],
  },
  {
    label: 'Automation',
    items: [{ to: '/pipelines', label: 'Pipelines', icon: Workflow }],
  },
  {
    label: 'Platform',
    items: [
      { to: '/integrations', label: 'Integrations', icon: PlugZap },
      { to: '/admin', label: 'Administration', icon: Settings },
    ],
  },
]

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

function isActive(pathname: string, to: string): boolean {
  return to === '/'
    ? pathname === '/'
    : pathname === to || pathname.startsWith(to + '/')
}

export function AppShell({
  context,
  breadcrumbs,
  navSections = defaultNavSections,
  projectTree,
  navExtra,
  primaryAction,
  title,
  status,
  actions,
  tabs,
  extensionCommands = [],
  onExtensionCommand,
  inspector,
  inspectorLabel = 'Inspector',
  inspectorCollapsible = false,
  fullBleed = false,
  children,
}: AppShellProps) {
  // All hooks MUST be called unconditionally — the early return for null
  // context used to sit above these, causing a Rules of Hooks violation
  // that produced an infinite flicker loop when context transitioned from
  // null to set (hook count changed → React remounted → context dropped
  // → route re-set it → remount again).
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { theme, setTheme } = useTheme()

  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [inspectorOpen, setInspectorOpen] = React.useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState(false)

  // NAV-03: return focus to the trigger when the palette Dialog or the
  // mobile navigation Sheet closes (both open under state control, not via
  // a Radix Trigger, so Radix has no trigger to restore to).
  const capturePaletteFocus = useFocusRestore(commandOpen)
  const captureMobileFocus = useFocusRestore(mobileOpen)

  const navigate = useNavigate()
  const openPalette = React.useCallback(() => {
    capturePaletteFocus()
    setCommandOpen(true)
  }, [capturePaletteFocus])
  const [helpOpen, setHelpOpen] = React.useState(false)

  React.useEffect(() => {
    let saved = false
    try {
      saved = localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      /* ignore: private mode / disabled storage */
    }
    // SHELL-05: at laptop width (1024–1279) the design shows a 48px rail.
    const laptop =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(min-width: 1024px) and (max-width: 1279px)').matches
    setCollapsed(saved || laptop)
  }, [])

  // Collapsible inspector persistence — separate key from the left sidebar
  // so the two panels remember their state independently.
  React.useEffect(() => {
    if (!inspectorCollapsible) return
    try {
      setInspectorCollapsed(
        localStorage.getItem(INSPECTOR_COLLAPSE_KEY) === '1',
      )
    } catch {
      /* ignore */
    }
  }, [inspectorCollapsible])

  const toggleCollapsed = React.useCallback(() => {
    const next = !collapsed
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
    setCollapsed(next)
  }, [collapsed])

  const toggleInspectorCollapsed = React.useCallback(() => {
    const next = !inspectorCollapsed
    try {
      localStorage.setItem(INSPECTOR_COLLAPSE_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
    setInspectorCollapsed(next)
  }, [inspectorCollapsed])

  const globalShortcuts = React.useMemo(
    () =>
      createGlobalShortcuts({
        openPalette,
        openHelp: () => setHelpOpen(true),
        toggleRail: toggleCollapsed,
        navigate: (to) => void navigate({ to }),
        destinations: G_SEQUENCE_DESTINATIONS,
      }),
    [navigate, openPalette, toggleCollapsed],
  )

  const signOut = React.useCallback(async () => {
    await authClient.signOut()
    router.invalidate()
  }, [router])

  // SHELL-01.4: switch the active workspace, then re-resolve the shell
  // context (and every workspace-scoped query) for the new workspace.
  const switchWorkspace = React.useCallback(
    async (workspaceId: string) => {
      try {
        await setActiveWorkspace(createDataClient(), workspaceId)
      } catch {
        /* keep the current workspace if the switch is refused */
      }
      router.invalidate()
    },
    [router],
  )

  // SHELL-01.2: the Pipelines nav shows the count of recently failed runs.
  const [failedRunCount, setFailedRunCount] = React.useState(0)
  React.useEffect(() => {
    if (!context) {
      setFailedRunCount(0)
      return
    }
    let cancelled = false
    void listRecentPipelineRuns(createDataClient(), 50)
      .then((runs) => {
        if (!cancelled)
          setFailedRunCount(
            runs.filter((run) => run.status === 'failed').length,
          )
      })
      .catch(() => {
        if (!cancelled) setFailedRunCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [context])
  const navSectionsWithBadges = React.useMemo(
    () =>
      navSections.map((section) => ({
        ...section,
        items: section.items.map((item) =>
          item.to === '/pipelines' && failedRunCount > 0
            ? { ...item, badge: failedRunCount }
            : item,
        ),
      })),
    [navSections, failedRunCount],
  )

  const renderSidebarBody = (sidebarCollapsed: boolean) =>
    context ? (
      <div className="flex h-full flex-col">
        <div className="flex h-topbar items-center border-b border-sidebar-border px-3">
          <Link
            to="/"
            aria-label="Sheetbase ELN home"
            className="flex items-center gap-2 no-underline"
            onClick={() => setMobileOpen(false)}
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <span className="font-display text-sm font-semibold">S</span>
            </span>
            {!sidebarCollapsed && (
              <span className="font-display text-sm font-semibold leading-none text-sidebar-foreground">
                Sheetbase ELN
              </span>
            )}
          </Link>
          {!sidebarCollapsed ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto hidden md:inline-flex"
              aria-label="Collapse sidebar"
              aria-pressed="false"
              onClick={toggleCollapsed}
            >
              <PanelLeftClose />
            </Button>
          ) : null}
        </div>

        <div className={cn('px-2 py-3', sidebarCollapsed && 'hidden')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="flex h-9 w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar px-2 text-left text-sm shadow-xs hover:bg-sidebar-accent/60"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {context.workspace
                    ? context.workspace.name.slice(0, 2).toUpperCase()
                    : 'WS'}
                </span>
                <span className="flex-1 truncate font-medium text-sidebar-foreground">
                  {context.workspace ? context.workspace.name : 'No workspace'}
                </span>
                <ChevronsUpDown className="size-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {(
                context.workspaces ??
                (context.workspace ? [context.workspace] : [])
              ).map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id ?? workspace.name}
                  onSelect={() => {
                    if (workspace.id) void switchWorkspace(workspace.id)
                  }}
                >
                  {workspace.id && workspace.id === context.workspace?.id ? (
                    <Check className="mr-2 size-4" />
                  ) : (
                    <span className="mr-2 size-4" />
                  )}
                  {workspace.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Create workspace</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {sidebarCollapsed ? (
          <div className="px-2 py-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="w-full"
                  aria-label="Expand sidebar"
                  aria-pressed="true"
                  onClick={toggleCollapsed}
                >
                  <PanelLeftOpen />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expand sidebar</TooltipContent>
            </Tooltip>
          </div>
        ) : null}

        <nav
          id={APP_SHELL_NAV_ID}
          aria-label="Primary"
          className={cn(
            'flex-1 overflow-y-auto px-2 pb-4',
            sidebarCollapsed && 'px-2',
          )}
        >
          {navSectionsWithBadges.map((section) => (
            <div key={section.label ?? 'section'} className="mb-2">
              {section.label && !sidebarCollapsed && (
                <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <NavRow
                    key={item.to}
                    item={item}
                    active={isActive(pathname, item.to)}
                    collapsed={sidebarCollapsed}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </ul>
            </div>
          ))}

          {projectTree && !sidebarCollapsed && (
            <div className="mb-2">
              <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Current project
              </p>
              {projectTree}
            </div>
          )}

          {navExtra && !sidebarCollapsed && (
            <div className="mb-2">{navExtra}</div>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  'flex h-auto w-full items-center gap-2 rounded-md p-2 text-left hover:bg-sidebar-accent/60',
                  sidebarCollapsed && 'justify-center',
                )}
                aria-label={`Account: ${context.user.name}`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-xs font-semibold text-primary">
                  {initials(context.user.name) || 'U'}
                </span>
                {!sidebarCollapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-sidebar-foreground">
                      {context.user.name}
                    </span>
                    {context.user.role ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {context.user.role}
                      </span>
                    ) : null}
                  </span>
                )}
                {!sidebarCollapsed && (
                  <ChevronsUpDown className="size-4 text-muted-foreground" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuLabel>{context.user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Settings className="mr-2 size-4" /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) =>
                  setTheme(value as 'system' | 'light' | 'dark')
                }
              >
                <DropdownMenuRadioItem value="system">
                  System
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={signOut}>
                <LogOut className="mr-2 size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    ) : null

  return (
    <ShortcutProvider definitions={globalShortcuts}>
      <TooltipProvider delayDuration={200}>
        <div className="min-h-svh bg-background text-foreground">
          {context && (
            <a
              href={`#${APP_SHELL_MAIN_ID}`}
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
            >
              Skip to content
            </a>
          )}

          {context && (
            <aside
              aria-label="Application navigation"
              data-slot="sidebar"
              className={cn(
                'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar lg:flex',
                collapsed ? 'lg:w-12' : 'lg:w-nav',
              )}
              data-collapsed={collapsed ? 'true' : 'false'}
            >
              {renderSidebarBody(collapsed)}
            </aside>
          )}

          {context && (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent
                side="left"
                className="w-nav border-r border-sidebar-border bg-sidebar p-0 lg:hidden"
              >
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                {renderSidebarBody(false)}
              </SheetContent>
            </Sheet>
          )}

          <div
            className={cn(
              fullBleed
                ? 'flex h-svh flex-col overflow-hidden'
                : 'flex min-h-svh flex-col',
              context && (collapsed ? 'lg:pl-12' : 'lg:pl-nav'),
            )}
          >
            {context && (
              <header className="sticky top-0 z-30 flex h-topbar items-center gap-2 border-b border-sidebar-border bg-background px-4 md:px-6">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label="Open navigation"
                  onClick={() => {
                    captureMobileFocus()
                    setMobileOpen(true)
                  }}
                >
                  <Menu />
                </Button>

                <TopBarActions
                  onOpenPalette={openPalette}
                  primaryAction={primaryAction}
                  hasInspector={Boolean(inspector)}
                  inspectorLabel={inspectorLabel}
                  inspectorCollapsible={inspectorCollapsible}
                  inspectorCollapsed={inspectorCollapsed}
                  onOpenInspector={() => setInspectorOpen(true)}
                  onToggleInspector={toggleInspectorCollapsed}
                />
              </header>
            )}

            <div className="flex flex-1 overflow-hidden">
              <main
                id={APP_SHELL_MAIN_ID}
                tabIndex={-1}
                className={cn(
                  'min-h-0 min-w-0 flex-1',
                  fullBleed && 'flex flex-col overflow-hidden',
                )}
              >
                {/* Keep the route at the same React depth when its layout changes.
                  Remounting it runs useShell cleanup, which changes the layout
                  again and can repeatedly tear down the active route. */}
                {!fullBleed ? (
                  <PageHeader
                    breadcrumbs={breadcrumbs}
                    title={title}
                    status={status}
                    actions={actions}
                    tabs={tabs}
                  />
                ) : null}
                <div
                  className={
                    fullBleed
                      ? 'contents'
                      : 'mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8'
                  }
                >
                  {children}
                </div>
              </main>

              {context && inspector ? (
                <ShellInspector
                  label={inspectorLabel}
                  collapsible={inspectorCollapsible}
                  collapsed={inspectorCollapsed}
                  onToggle={toggleInspectorCollapsed}
                >
                  {inspector}
                </ShellInspector>
              ) : null}
            </div>
          </div>

          {context && inspector ? (
            <ShellInspectorSheet
              open={inspectorOpen}
              onOpenChange={setInspectorOpen}
              label={inspectorLabel}
            >
              {inspector}
            </ShellInspectorSheet>
          ) : null}

          {context && (
            <CommandPalette
              open={commandOpen}
              onOpenChange={setCommandOpen}
              navSections={navSectionsWithBadges}
              onNavigate={() => setMobileOpen(false)}
              theme={theme}
              setTheme={setTheme}
              onSignOut={signOut}
              extensionCommands={extensionCommands}
              onExtensionCommand={onExtensionCommand}
            />
          )}
        </div>
        <ShortcutsDialog
          open={helpOpen}
          onOpenChange={setHelpOpen}
          definitions={globalShortcuts}
        />
      </TooltipProvider>
    </ShortcutProvider>
  )
}

function NavRow({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: AppShellNavItem
  active: boolean
  collapsed: boolean
  onNavigate: () => void
}) {
  const Icon = item.icon
  const label = (
    <>
      <Icon className="size-4 shrink-0" />
      {!collapsed ? (
        <span className="flex-1 truncate">{item.label}</span>
      ) : null}
      {!collapsed && item.badge !== undefined && Number(item.badge) > 0 ? (
        <Badge variant="secondary" className="ml-auto">
          {item.badge}
        </Badge>
      ) : null}
    </>
  )

  if (item.disabled) {
    const inner = (
      <span
        aria-disabled="true"
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          'flex h-9 cursor-not-allowed items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground/60 no-underline',
          collapsed && 'justify-center px-0',
        )}
        title={`${item.label} (coming soon)`}
      >
        {label}
      </span>
    )
    return (
      <li>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex justify-center">{inner}</span>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          inner
        )}
      </li>
    )
  }

  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={item.to}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            aria-label={collapsed ? item.label : undefined}
            className={cn(
              'flex h-8 items-center gap-2 rounded-md px-3 text-body no-underline transition-colors max-lg:min-h-11',
              active
                ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
                : 'font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            {label}
          </Link>
        </TooltipTrigger>
        {collapsed && (
          <TooltipContent side="right">{item.label}</TooltipContent>
        )}
      </Tooltip>
    </li>
  )
}

function CommandPalette({
  open,
  onOpenChange,
  navSections,
  onNavigate,
  theme,
  setTheme,
  onSignOut,
  extensionCommands = [],
  onExtensionCommand,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  navSections: AppShellNavSection[]
  onNavigate: () => void
  theme: 'light' | 'dark' | 'system'
  setTheme: (t: 'light' | 'dark' | 'system') => void
  onSignOut: () => void
  extensionCommands?: ResolvedExtensionContribution[]
  onExtensionCommand?: (command: ResolvedExtensionContribution) => void
}) {
  const navigate = useNavigate()
  const go = (to: string) => {
    onNavigate()
    onOpenChange(false)
    // Client-side navigation — a full page reload here would discard the
    // TanStack Router cache and live-event subscriptions.
    void navigate({ to })
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command>
          <CommandInput placeholder="Search pages and actions…" />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {navSections.map((section) => {
              const items = section.items.filter((item) => !item.disabled)
              if (items.length === 0) return null
              const heading =
                section.label === 'More'
                  ? 'More (specialist)'
                  : (section.label ?? 'Navigate')
              return (
                <CommandGroup key={heading} heading={heading}>
                  {items.map((item) => (
                    <CommandItem
                      key={item.to}
                      value={item.label}
                      onSelect={() => go(item.to)}
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
            <FavouritesCommandGroup onSelect={go} />
            <ProjectsCommandGroup open={open} onSelect={go} />
            <ExtensionCommandGroup
              commands={extensionCommands}
              onSelect={(command) => {
                onOpenChange(false)
                onExtensionCommand?.(command)
              }}
            />
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => {
                  setTheme(theme === 'dark' ? 'light' : 'dark')
                  onOpenChange(false)
                }}
              >
                {theme === 'dark' ? (
                  <Sun className="size-4" />
                ) : (
                  <Moon className="size-4" />
                )}
                Toggle colour mode
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  onOpenChange(false)
                  void onSignOut()
                }}
              >
                <LogOut className="size-4" />
                Sign out
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium">Go to:</span>
            <span>g h Home</span>
            <span>g p Projects</span>
            <span>g d Datasets</span>
            <span>g s Sheets</span>
            <span>g t Templates</span>
            <span>g a Samples</span>
            <span>g r Reagents</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Favourites (FIND-02) in the command palette.
//
// Minimal additive integration with the canonical navigation model: the
// ⌘K palette lists the user's resolved favourites (canonical labels and
// destinations from `src/lib/navigation.ts`, capped at FAVOURITES_LIMIT)
// as an extra group above Actions. No parallel search model and no nav
// restructuring — the palette is the existing keyboard navigation surface.
// Mounted inside the palette Dialog, so the query only runs while the
// palette is open; failures degrade to "group absent", never an error UI.
// ---------------------------------------------------------------------------

const FAVOURITE_KIND_LABELS: Record<FavouriteItem['kind'], string> = {
  record: 'Record',
  dataset: 'Dataset',
  sheet: 'Sheet',
  project: 'Project',
  notebook_template: 'Template',
}

const FAVOURITE_KIND_ICONS: Record<FavouriteItem['kind'], LucideIcon> = {
  record: FlaskConical,
  dataset: Database,
  sheet: GanttChart,
  project: FolderOpen,
  notebook_template: LayoutTemplate,
}

function FavouritesCommandGroup({
  onSelect,
}: {
  onSelect: (to: string) => void
}) {
  const itemsQuery = useQuery({
    queryKey: favouritesQueryKeys.items(),
    queryFn: () => fetchFavouriteItems(notebookDataClient, FAVOURITES_LIMIT),
    staleTime: 30_000,
    retry: false,
  })
  const items = itemsQuery.data ?? []
  if (items.length === 0) return null
  return (
    <CommandGroup heading="Favourites">
      {items.map((item) => {
        const Icon = FAVOURITE_KIND_ICONS[item.kind]
        return (
          <CommandItem
            key={`${item.kind}:${item.id}`}
            value={`${item.label} ${item.identifier ?? ''} ${FAVOURITE_KIND_LABELS[item.kind]} favourite`}
            onSelect={() => onSelect(item.destination)}
          >
            <Icon className="size-4" />
            <span className="flex-1 truncate">{item.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {FAVOURITE_KIND_LABELS[item.kind]}
            </span>
            <Star
              className="size-3.5 shrink-0 fill-warning text-warning-text"
              aria-hidden="true"
            />
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

// ---------------------------------------------------------------------------
// Projects (NAV-03) in the command palette.
//
// Compact project switcher: up to 10 projects via the shared
// `notebookQueryKeys.projectsList()` key (same collection the workspace
// views list — no new fetch layer), mounted inside the palette Dialog and
// enabled only while it is open. Loading and failure render no group,
// never an error UI — the same degradation pattern as Favourites above.
// Selecting a project navigates to its canonical `projectPath` and closes
// the palette.
// ---------------------------------------------------------------------------

const PROJECTS_COMMAND_LIMIT = 10

function ProjectsCommandGroup({
  open,
  onSelect,
}: {
  open: boolean
  onSelect: (to: string) => void
}) {
  const projectsQuery = useQuery({
    queryKey: notebookQueryKeys.projectsList(),
    queryFn: () =>
      notebookDataClient.list<ProjectWire>('projects', '?order=title.asc'),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  })
  const projects = (projectsQuery.data ?? []).slice(0, PROJECTS_COMMAND_LIMIT)
  if (projects.length === 0) return null
  return (
    <CommandGroup heading="Projects">
      {projects.map((project) => (
        <CommandItem
          key={project.id}
          value={`${project.title} ${project.key} project`}
          onSelect={() => onSelect(projectPath(project.id))}
        >
          <FolderOpen className="size-4" />
          <span className="flex-1 truncate">{project.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {project.key}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
