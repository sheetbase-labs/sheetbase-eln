// @vitest-environment jsdom
'use client'

import * as React from 'react'
import {
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import {
  Activity as ActivityIcon,
  Bell,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  ClipboardList,
  Database,
  FlaskConical,
  Home as HomeIcon,
  LayoutGrid,
  LayoutTemplate,
  LineChart as LineChartIcon,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { authClient } from '#/lib/auth-client'
import { cn } from '#/lib/utils'
import { useTheme } from '#/components/theme-provider'
import { ConnectionStatus, useLiveStatus } from '#/components/live'
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
 * product route. See `docs/decisions/0009-application-shell.md`.
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

export const APP_SHELL_MAIN_ID = 'app-shell-main'
export const APP_SHELL_NAV_ID = 'app-shell-nav'

export interface AppShellBreadcrumb {
  label: string
  to?: string
}

export interface AppShellNavItem {
  to: string
  label: string
  icon: LucideIcon
  badge?: string | number
  disabled?: boolean
}

export interface AppShellNavSection {
  label?: string
  items: AppShellNavItem[]
}

export interface AppShellWorkspace {
  name: string
}

export interface AppShellUser {
  name: string
  email: string
  role?: string
}

export interface AppShellContext {
  workspace: AppShellWorkspace | null
  user: AppShellUser
}

export interface AppShellProps {
  context: AppShellContext
  breadcrumbs: AppShellBreadcrumb[]
  navSections?: AppShellNavSection[]
  /** Active-project tree slot rendered under a PROJECTS heading. */
  projectTree?: React.ReactNode
  /** Optional VIEWS/saved-filters slot rendered after the project tree. */
  navExtra?: React.ReactNode
  /** Primary action rendered in the top bar (e.g. + New). */
  primaryAction?: React.ReactNode
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
export const defaultNavSections: AppShellNavSection[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: HomeIcon },
      { to: '/search', label: 'Search', icon: Search },
      { to: '/templates', label: 'Templates', icon: LayoutTemplate },
      { to: '/reagents', label: 'Reagents', icon: FlaskConical },
      { to: '/schemas', label: 'Schemas', icon: Database },
      { to: '/datasets', label: 'Datasets', icon: Database },
      { to: '/analysis', label: 'Analysis', icon: LineChartIcon },
      { to: '/samples', label: 'Samples', icon: FlaskConical },
      { to: '/my-work', label: 'My work', icon: LayoutGrid, disabled: true },
      {
        to: '/activity',
        label: 'Activity',
        icon: ActivityIcon,
        disabled: true,
      },
      {
        to: '/tasks',
        label: 'Tasks',
        icon: ClipboardList,
        badge: 0,
        disabled: true,
      },
      {
        to: '/reviews',
        label: 'Reviews',
        icon: CheckCircle2,
        badge: 0,
      },
    ],
  },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground sm:flex">
      {children}
    </kbd>
  )
}

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
  inspector,
  inspectorLabel = 'Inspector',
  inspectorCollapsible = false,
  fullBleed = false,
  children,
}: AppShellProps) {
  const router = useRouter()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { theme, setTheme, density, setDensity } = useTheme()

  // LIVE-003: quiet connection-status indicator in the top bar. The
  // coordinator is mounted at the root; this just subscribes to its
  // status snapshot.
  const liveStatus = useLiveStatus()

  const [collapsed, setCollapsed] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [inspectorOpen, setInspectorOpen] = React.useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = React.useState(false)

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1')
    } catch {
      /* ignore: private mode / disabled storage */
    }
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
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const toggleInspectorCollapsed = React.useCallback(() => {
    setInspectorCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(INSPECTOR_COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const signOut = React.useCallback(async () => {
    await authClient.signOut()
    router.invalidate()
  }, [router])

  const allNavItems = React.useMemo(
    () => navSections.flatMap((s) => s.items),
    [navSections],
  )

  const sidebarBody = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center border-b border-sidebar-border px-3">
        <Link
          to="/"
          aria-label="Sheetbase ELN home"
          className="flex items-center gap-2 no-underline"
          onClick={() => setMobileOpen(false)}
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <span className="font-display text-sm font-semibold">S</span>
          </span>
          {!collapsed && (
            <span className="font-display text-sm font-semibold leading-none text-sidebar-foreground">
              Sheetbase ELN
            </span>
          )}
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto hidden md:inline-flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          onClick={toggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>

      <div className={cn('px-2 py-3', collapsed && 'hidden')}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
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
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            <DropdownMenuItem disabled>
              {context.workspace ? context.workspace.name : 'No workspace'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Create workspace</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav
        id={APP_SHELL_NAV_ID}
        aria-label="Primary"
        className={cn(
          'flex-1 overflow-y-auto px-2 pb-4',
          collapsed && 'px-1.5',
        )}
      >
        {navSections.map((section) => (
          <div key={section.label ?? 'section'} className="mb-2">
            {section.label && !collapsed && (
              <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <NavRow
                  key={item.to}
                  item={item}
                  active={isActive(pathname, item.to)}
                  collapsed={collapsed}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </ul>
          </div>
        ))}

        {projectTree && !collapsed && (
          <div className="mb-2">
            <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Projects
            </p>
            {projectTree}
          </div>
        )}

        {navExtra && !collapsed && <div className="mb-2">{navExtra}</div>}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-sidebar-accent/60',
                collapsed && 'justify-center',
              )}
              aria-label={`Account: ${context.user.name}`}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-xs font-semibold text-primary">
                {initials(context.user.name) || 'U'}
              </span>
              {!collapsed && (
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
              {!collapsed && (
                <ChevronsUpDown className="size-4 text-muted-foreground" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuLabel>{context.user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <Settings className="mr-2 size-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? (
                <Sun className="mr-2 size-4" />
              ) : (
                <Moon className="mr-2 size-4" />
              )}
              Toggle colour mode
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                setDensity(density === 'compact' ? 'comfortable' : 'compact')
              }
            >
              <Settings className="mr-2 size-4" /> Toggle density
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut}>
              <LogOut className="mr-2 size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-svh bg-background text-foreground">
        <a
          href={`#${APP_SHELL_MAIN_ID}`}
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>

        <aside
          aria-label="Application navigation"
          className={cn(
            'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar md:flex',
            collapsed ? 'md:w-14' : 'md:w-60',
          )}
          data-collapsed={collapsed ? 'true' : 'false'}
        >
          {sidebarBody}
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-72 border-r border-sidebar-border bg-sidebar p-0 md:hidden"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            {sidebarBody}
          </SheetContent>
        </Sheet>

        <div
          className={cn(
            fullBleed
              ? 'flex h-svh flex-col overflow-hidden'
              : 'flex min-h-svh flex-col',
            collapsed ? 'md:pl-14' : 'md:pl-60',
          )}
        >
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/92 px-4 backdrop-blur md:px-6">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </Button>

            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center gap-1.5 text-sm"
            >
              <HomeIcon className="size-3.5 shrink-0 text-muted-foreground" />
              {breadcrumbs.map((crumb, i) => {
                const last = i === breadcrumbs.length - 1
                return (
                  <React.Fragment key={`${crumb.label}-${i}`}>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                    {crumb.to && !last ? (
                      <Link
                        to={crumb.to}
                        className="truncate text-muted-foreground no-underline hover:text-foreground"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        className="truncate font-medium text-foreground"
                        aria-current={last ? 'page' : undefined}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </React.Fragment>
                )
              })}
            </nav>

            <div className="ml-auto flex items-center gap-1.5">
              <ConnectionStatus
                status={liveStatus.status}
                lastAppliedSeq={liveStatus.lastAppliedSeq}
              />
              <button
                type="button"
                onClick={() => setCommandOpen(true)}
                className="hidden h-8 items-center gap-2 rounded-md border bg-background px-3 text-left text-xs text-muted-foreground shadow-xs hover:bg-muted/50 sm:flex"
                aria-label="Search"
              >
                <Search className="size-3.5" />
                <span className="flex-1">Search</span>
                <Kbd>⌘K</Kbd>
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="sm:hidden"
                aria-label="Search"
                onClick={() => setCommandOpen(true)}
              >
                <Search />
              </Button>

              {primaryAction}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Help"
                    disabled
                  >
                    <CircleHelp />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Help</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Notifications"
                  >
                    <Bell />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Notifications</TooltipContent>
              </Tooltip>

              {inspector && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="xl:hidden"
                  aria-label={inspectorLabel}
                  aria-expanded={inspectorOpen}
                  onClick={() => setInspectorOpen(true)}
                >
                  <PanelRight />
                </Button>
              )}
              {inspector && inspectorCollapsible && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="hidden xl:inline-flex"
                      aria-label={
                        inspectorCollapsed ? 'Show inspector' : 'Hide inspector'
                      }
                      aria-expanded={!inspectorCollapsed}
                      onClick={toggleInspectorCollapsed}
                    >
                      <PanelRight
                        className={cn(
                          'size-4',
                          !inspectorCollapsed && 'text-foreground',
                        )}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {inspectorCollapsed ? 'Show inspector' : 'Hide inspector'}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </header>

          <div className="flex flex-1 overflow-hidden">
            <main
              id={APP_SHELL_MAIN_ID}
              tabIndex={-1}
              className={cn(
                'min-w-0 flex-1',
                fullBleed && 'flex flex-col overflow-hidden',
              )}
            >
              {fullBleed ? (
                children
              ) : (
                <div className="mx-auto w-full max-w-[1280px] px-4 py-6 md:px-8">
                  {children}
                </div>
              )}
            </main>

            {inspector && (
              <aside
                aria-label={inspectorLabel}
                className={cn(
                  'hidden shrink-0 border-l bg-background xl:block',
                  inspectorCollapsible && inspectorCollapsed ? 'w-10' : 'w-80',
                )}
                data-inspector-collapsed={
                  inspectorCollapsible && inspectorCollapsed ? 'true' : 'false'
                }
              >
                {inspectorCollapsible && inspectorCollapsed ? (
                  <div className="flex h-full flex-col items-center pt-3">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Show inspector"
                      aria-expanded={false}
                      onClick={toggleInspectorCollapsed}
                    >
                      <PanelRight className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="sticky top-14 h-[calc(100svh-3.5rem)] overflow-y-auto p-4">
                    {inspector}
                  </div>
                )}
              </aside>
            )}
          </div>
        </div>

        {inspector && (
          <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
            <SheetContent side="right" className="w-80 border-l p-0 xl:hidden">
              <SheetTitle className="sr-only">{inspectorLabel}</SheetTitle>
              <div className="h-full overflow-y-auto p-4">{inspector}</div>
            </SheetContent>
          </Sheet>
        )}

        <CommandPalette
          open={commandOpen}
          onOpenChange={setCommandOpen}
          navItems={allNavItems}
          onNavigate={() => setMobileOpen(false)}
          theme={theme}
          setTheme={setTheme}
          density={density}
          setDensity={setDensity}
          onSignOut={signOut}
        />
      </div>
    </TooltipProvider>
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
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && Number(item.badge) > 0 ? (
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
        className={cn(
          'flex h-9 cursor-not-allowed items-center gap-2 rounded-md px-2.5 text-sm font-medium text-muted-foreground/60 no-underline',
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
            className={cn(
              'flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium no-underline transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
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
  navItems,
  onNavigate,
  theme,
  setTheme,
  density,
  setDensity,
  onSignOut,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  navItems: AppShellNavItem[]
  onNavigate: () => void
  theme: 'light' | 'dark' | 'system'
  setTheme: (t: 'light' | 'dark' | 'system') => void
  density: 'comfortable' | 'compact'
  setDensity: (d: 'comfortable' | 'compact') => void
  onSignOut: () => void
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
            <CommandGroup heading="Navigate">
              {navItems
                .filter((i) => !i.disabled)
                .map((item) => (
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
                  setDensity(density === 'compact' ? 'comfortable' : 'compact')
                  onOpenChange(false)
                }}
              >
                <Settings className="size-4" />
                Toggle density
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
        </Command>
      </DialogContent>
    </Dialog>
  )
}
