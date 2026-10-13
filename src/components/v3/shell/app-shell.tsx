import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { Icon } from '#/components/v3/icons'
import { Button, buttonVariants } from '#/components/v3/ui/button'
import { Avatar } from '#/components/v3/ui/avatar'
import { Dot } from '#/components/v3/ui/status'
import { Kbd } from '#/components/v3/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/v3/ui/popover'
import { useTheme } from '#/components/v3/lib/theme'
import {
  retainDraftsOnSignOut,
  webSignOutRetentionStorage,
} from '#/lib/offline/retention'
import {
  createIndexedDbStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import { createDataClient } from '#/lib/data-client'
import {
  fetchUserPreferences,
  setActiveWorkspace,
  setUserAppearance,
  setUserPreference,
} from '#/lib/user-preferences'
import { createGlobalShortcuts } from '#/lib/global-shortcuts'
import type { GlobalShortcutDestination } from '#/lib/global-shortcuts'
import { OPEN_SHORTCUTS_EVENT } from '#/lib/shortcuts-dialog'
import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import { RegistryShortcutsDialog } from '#/components/shortcuts/shortcuts-dialog'
import type { ThemePref } from '#/components/v3/lib/theme'
import { cn } from '#/lib/utils'
import type { Notification, NotificationTarget } from '#/components/v3/types'
import { markNotificationsRead } from '#/lib/notifications-data'
import { isHomeSection, primaryNav, recordNav } from './nav'
import type { NavItem } from './nav'
import { filterNavForRole } from '#/lib/nav-visibility'
import { Sheet, SheetContent } from '#/components/v3/ui/sheet'
import { Tooltip } from '#/components/v3/ui/tooltip'
import { SearchPalette } from '#/components/v3/search/search-palette'
import { authClient } from '#/lib/auth-client'
import { Notice } from '#/components/v3/ui/alert'

const SIDEBAR_COLLAPSE_KEY = 'sheetbase-sidebar-collapsed'

/** The `G` then key destinations the design lists (plus the real routes). */
const G_DESTINATIONS: GlobalShortcutDestination[] = [
  { key: 'h', to: '/', label: 'Home' },
  { key: 'i', to: '/inbox', label: 'Inbox' },
  { key: 'e', to: '/experiments', label: 'Experiments' },
  { key: 'p', to: '/projects', label: 'Projects' },
  { key: 'a', to: '/samples', label: 'Samples' },
  { key: 'd', to: '/datasets', label: 'Datasets' },
]

type ShellData = {
  me: { id: string; name: string; initials: string; role: string }
  notifications: Notification[]
  pinned: { id: string; name: string; tone: 'progress' | 'review' }[]
  /** Live counts keyed by nav label: Inbox, Datasets, Pipelines. */
  counts?: { inbox?: string; datasets?: string; pipelines?: string }
  /** SHELL-01: the caller's active workspace and all their memberships. */
  workspace?: { id: string; name: string } | null
  workspaces?: { id: string; name: string }[]
}

/**
 * UI port (branch roadmap-4/ui-app3): sheetbase-app-3's shell, adapted to the
 * ELN's route tree. The ⌘K search palette reads the real search RPC.
 */
export function AppShell({
  data,
  children,
}: {
  data: ShellData
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const theme = useTheme()
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  /** SHELL-01/03: a toggle the user has already made outranks the slower fetch. */
  const collapseTouched = useRef(false)
  /**
   * SHELL-02: the ids marked read in this session. The bell's rows come from the
   * server snapshot, so the action has to be remembered here until the shell
   * re-resolves — otherwise the rows revert to unread on the next render.
   */
  const [readNotifications, setReadNotifications] =
    useState<ReadonlySet<string>>(() => new Set())

  // SHELL-01.2: omit navigation a workspace role cannot open. Everyday
  // scientific items declare no `roles`/`capability`, so they stay visible.
  const role = data.me.role
  const primaryItems = useMemo(() => filterNavForRole(primaryNav, role), [role])
  const recordItems = useMemo(() => filterNavForRole(recordNav, role), [role])

  // SHELL-01/03: the sidebar collapse is a per-user preference.
  useEffect(() => {
    let saved = false
    try {
      saved = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1'
    } catch {
      /* private mode / disabled storage */
    }
    setCollapsed(saved)
    let cancelled = false
    void fetchUserPreferences(createDataClient())
      .then((preferences) => {
        if (cancelled || !preferences) return
        // SHELL-01/03: the stored preference is the source of truth, but it must
        // not overwrite a toggle the user has already made while it was in
        // flight. Applying it also reconciles the local mirror, so the next load
        // starts from the same value.
        if (collapseTouched.current) return
        setCollapsed(preferences.navCollapsed)
        try {
          localStorage.setItem(
            SIDEBAR_COLLAPSE_KEY,
            preferences.navCollapsed ? '1' : '0',
          )
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const toggleCollapsed = useCallback(() => {
    collapseTouched.current = true
    setCollapsed((current) => {
      const next = !current
      try {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      void setUserPreference(createDataClient(), {
        appearance: theme.pref,
        navCollapsed: next,
      }).catch(() => undefined)
      return next
    })
  }, [theme.pref])

  // SHELL-01: switch the active workspace, then re-resolve the shell context
  // (and every workspace-scoped query) for the new workspace. A refused switch
  // throws: the switcher shows the reason, and the shell is not re-resolved onto
  // a workspace the caller never became active in.
  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      await setActiveWorkspace(createDataClient(), workspaceId)
      await router.invalidate()
    },
    [router],
  )

  // SHELL-02: mark read is a real write through the same RPC the legacy bell
  // uses, so the rows stay read after a reload instead of reverting.
  const markNotifications = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      await markNotificationsRead(createDataClient(), ids)
      setReadNotifications((current) => new Set([...current, ...ids]))
      await router.invalidate()
    },
    [router],
  )

  /** SHELL-02: unread means unread on the server and not marked read here. */
  const unreadIds = useMemo(
    () =>
      new Set(
        data.notifications
          .filter((n) => n.unread && !readNotifications.has(n.id))
          .map((n) => n.id),
      ),
    [data.notifications, readNotifications],
  )

  // SHELL-03: one registry for the shell; the `?` dialog is generated from it.
  const globalShortcuts = useMemo(
    () =>
      createGlobalShortcuts({
        openPalette: () => setSearch(true),
        openHelp: () => setHelpOpen(true),
        openCreate: () => setCreateOpen(true),
        toggleRail: toggleCollapsed,
        navigate: (to) => void navigate({ to: to as never }),
        destinations: G_DESTINATIONS,
      }),
    [navigate, toggleCollapsed],
  )

  // The Help page opens the same dialog through the shared event.
  useEffect(() => {
    const onOpen = () => setHelpOpen(true)
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen)
  }, [])

  return (
    <ShortcutProvider definitions={globalShortcuts}>
      <div className="flex h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <TopBar
          data={data}
          unreadIds={unreadIds}
          onMarkNotificationsRead={markNotifications}
          onMenu={() => setMenu(true)}
          onSearch={() => setSearch(true)}
          createOpen={createOpen}
          onCreateOpenChange={setCreateOpen}
          onSwitchWorkspace={switchWorkspace}
        />
        <div className="flex min-h-0 flex-1">
          {collapsed ? (
            <NavRail
              className="hidden lg:flex"
              primaryItems={primaryItems}
              recordItems={recordItems}
            />
          ) : (
            <>
              <SideNav
                pinned={data.pinned}
                counts={data.counts}
                primaryItems={primaryItems}
                recordItems={recordItems}
                className="hidden xl:flex"
              />
              <NavRail
                className="hidden lg:flex xl:hidden"
                primaryItems={primaryItems}
                recordItems={recordItems}
              />
            </>
          )}
          <main id="main" className="flex min-w-0 flex-1 bg-background">
            {children}
          </main>
        </div>
        <BottomTabs counts={data.counts} />
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetContent side="left" title="Sheetbase">
            <SideNav
              pinned={data.pinned}
              counts={data.counts}
              primaryItems={primaryItems}
              recordItems={recordItems}
              onNavigate={() => setMenu(false)}
              className="h-full border-r-0"
            />
          </SheetContent>
        </Sheet>
        <SearchPalette open={search} onOpenChange={setSearch} />
        <RegistryShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
    </ShortcutProvider>
  )
}

function NavRail({
  className,
  primaryItems,
  recordItems,
}: {
  className?: string
  primaryItems: NavItem[]
  recordItems: NavItem[]
}) {
  const homeSelected = useRouterState({
    select: (state) => isHomeSection(state.location.pathname),
  })
  const selectedProps = {
    className: 'bg-selection text-fg!',
    'aria-current': 'page' as const,
  }
  return (
    <nav
      aria-label="Main"
      className={cn(
        'w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-border bg-surface py-2',
        className,
      )}
    >
      {[...primaryItems, null, ...recordItems].map((i, n) =>
        i === null ? (
          <div key={n} className="my-1 h-px w-6 bg-border-subtle" />
        ) : (
          <Tooltip key={i.label} content={i.label}>
            <Link
              {...i.link}
              aria-label={i.label}
              activeOptions={{ exact: i.label === 'Home' }}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
              activeProps={selectedProps}
              inactiveProps={
                i.label === 'Home' && homeSelected ? selectedProps : undefined
              }
            >
              <Icon name={i.icon} size={16} />
            </Link>
          </Tooltip>
        ),
      )}
      <div className="flex-1" />
      <Tooltip content="Settings">
        <Link
          to="/settings"
          aria-label="Settings"
          className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
          activeProps={{
            className: 'bg-selection text-fg!',
            'aria-current': 'page',
          }}
        >
          <Icon name="settings" size={16} />
        </Link>
      </Tooltip>
    </nav>
  )
}

function BottomTabs({
  counts,
}: {
  counts?: ShellData['counts']
}) {
  // SHELL-02: the phone bar's Inbox badge labels the same destination the
  // drawer and the desktop rail do, so it reads the same number. The unread
  // notification count belongs to the bell alone.
  const inboxCount = counts?.inbox
  const homeSelected = useRouterState({
    select: (state) => isHomeSection(state.location.pathname),
  })
  const selectedProps = {
    className: 'text-link!',
    'aria-current': 'page' as const,
  }
  const cls =
    'flex min-h-14 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border-0 bg-transparent text-[11px] font-medium text-fg-muted no-underline hover:text-fg hover:no-underline'
  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <Link
        to="/"
        className={cls}
        activeOptions={{ exact: true }}
        activeProps={selectedProps}
        inactiveProps={homeSelected ? selectedProps : undefined}
      >
        <Icon name="home" size={22} />
        Today
      </Link>
      <Link
        to="/scan"
        className={cls}
        activeProps={{ className: 'text-link!', 'aria-current': 'page' }}
      >
        <Icon name="scan" size={22} />
        Scan
      </Link>
      <Link
        to="/inbox"
        className={cn(cls, 'relative')}
        activeProps={{ className: 'text-link!', 'aria-current': 'page' }}
      >
        <Icon name="inbox" size={22} />
        Inbox
        {inboxCount ? (
          <span className="absolute right-[calc(50%-18px)] top-2 min-w-4 rounded-full bg-link px-1 text-[10px] leading-4 text-on-accent">
            {inboxCount}
          </span>
        ) : null}
      </Link>
    </nav>
  )
}

/** The destinations the bottom bar owns; a phone has nowhere to go back from. */
const PHONE_TOP_LEVEL_PATHS = new Set(['/', '/scan', '/inbox', '/settings'])

/**
 * MOB-01.1 — the phone header's back button. Below the phone breakpoint the
 * sidebar that would otherwise show where you came from is hidden, so the header
 * carries the affordance instead. It is absent on the bottom bar's own
 * destinations, where there is nowhere to go back to.
 */
function PhoneBackButton() {
  const router = useRouter()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  if (PHONE_TOP_LEVEL_PATHS.has(pathname)) return null
  return (
    <Button
      variant="quiet"
      size="icon"
      icon="arrowLeft"
      aria-label="Back"
      onClick={() => router.history.back()}
      className="md:hidden"
    />
  )
}

function TopBar({
  data,
  unreadIds,
  onMarkNotificationsRead,
  onMenu,
  onSearch,
  createOpen,
  onCreateOpenChange,
  onSwitchWorkspace,
}: {
  data: ShellData
  unreadIds: ReadonlySet<string>
  onMarkNotificationsRead: (ids: string[]) => Promise<void>
  onMenu: () => void
  onSearch: () => void
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
  onSwitchWorkspace: (workspaceId: string) => Promise<void>
}) {
  return (
    <header className="flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-surface px-2 md:gap-3 md:px-3">
      <Button
        variant="quiet"
        size="icon"
        icon="schema"
        aria-label="Open navigation"
        onClick={onMenu}
        className="lg:hidden max-md:hidden"
      />
      {/* MOB-01.1: on a phone the header carries a back button, because the
          sidebar that would otherwise show where you came from is hidden. It is
          absent on the top-level destinations, where there is nowhere to go back
          to. */}
      <PhoneBackButton />
      <Link
        to="/"
        className="flex shrink-0 items-center gap-2 max-md:pl-1 xl:w-[208px] font-display text-[15px] leading-[normal] font-semibold text-fg no-underline hover:text-fg hover:no-underline"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="15" height="15" rx="3" />
          <path d="M2.5 8h15M8 8v9.5" />
        </svg>
        Sheetbase
      </Link>
      <WorkspaceSwitcher
        workspace={data.workspace ?? null}
        workspaces={data.workspaces ?? []}
        onSwitch={onSwitchWorkspace}
      />
      <div className="flex min-w-0 flex-1 justify-end md:justify-center">
        <Button
          variant="quiet"
          size="icon"
          icon="search"
          aria-label="Search"
          onClick={onSearch}
          className="md:hidden"
        />
        <button
          type="button"
          onClick={onSearch}
          aria-keyshortcuts="Meta+K Control+K"
          className="flex h-[30px] w-[460px] max-w-full max-md:hidden cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-muted pl-2.5 pr-2 text-left font-[inherit] text-body text-fg-muted hover:border-border-strong"
        >
          <Icon name="search" size={14} />
          <span className="flex-1">Search experiments, samples, datasets</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
      <NewMenu open={createOpen} onOpenChange={onCreateOpenChange} />
      <Notifications
        items={data.notifications}
        unreadIds={unreadIds}
        onMarkRead={onMarkNotificationsRead}
      />
      <AccountMenu me={data.me} />
    </header>
  )
}

/**
 * SHELL-01: the workspace switcher. Lists the caller's memberships and sets the
 * active workspace for the session; a non-member workspace is refused by the
 * `set_active_workspace` RPC, which the menu reports instead of silently
 * staying on the old workspace. The trigger's visibility is the caller's, so the
 * phone drawer can carry the same menu below the `sm` breakpoint.
 *
 * There is no non-membership entry: a workspace is provisioned by its owner, and
 * no surface in the product creates one from here.
 */
function WorkspaceSwitcher({
  workspace,
  workspaces,
  onSwitch,
  className,
}: {
  workspace: { id: string; name: string } | null
  workspaces: { id: string; name: string }[]
  onSwitch: (workspaceId: string) => Promise<void>
  className?: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)

  async function choose(workspaceId: string) {
    setError(null)
    setPending(true)
    try {
      await onSwitch(workspaceId)
      setOpen(false)
    } catch {
      // The menu stays open so the reason is visible where the click was made.
      setError(
        'That workspace could not be opened. Check that you are still a member, then try again.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="quiet"
            aria-label="Switch workspace"
            className={cn('max-w-52 gap-1.5', className ?? 'hidden sm:flex')}
          />
        }
      >
        <span className="truncate">{workspace?.name ?? 'No workspace'}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[240px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((item) => (
            <DropdownMenuItem
              key={item.id}
              icon={item.id === workspace?.id ? 'check' : undefined}
              disabled={pending}
              closeOnClick={false}
              onClick={() => {
                // Choosing the workspace you are already in is a dismissal, not
                // a switch.
                if (item.id === workspace?.id) {
                  setOpen(false)
                  return
                }
                void choose(item.id)
              }}
            >
              {item.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {error ? (
          <div className="p-1">
            <Notice tone="bad">{error}</Notice>
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NewMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="primary"
            icon="plus"
            aria-label="New"
            className="max-md:size-10 max-md:px-0"
          />
        }
      >
        <span className="max-md:hidden">New</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuLinkItem
          icon="flask"
          hint="E"
          render={<Link to="/experiments/new" />}
        >
          Experiment
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          icon="tube"
          hint="S"
          render={<Link to="/samples" search={{ new: true }} />}
        >
          Sample
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          icon="folder"
          render={<Link to="/projects" search={{ new: true }} />}
        >
          Project
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem icon="table" render={<Link to="/sheets/new" />}>
          Working sheet
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem
          icon="upload"
          hint="I"
          render={<Link to="/import" />}
        >
          Import data
        </DropdownMenuLinkItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Where a notification's server-computed target leads in the route tree. */
function notificationLink(target: NotificationTarget) {
  switch (target.kind) {
    case 'pipeline-run':
      return {
        to: '/pipelines/runs/$runId' as const,
        params: { runId: target.id },
      }
    case 'dataset':
      return {
        to: '/datasets/$datasetId' as const,
        params: { datasetId: target.id },
      }
    case 'sample':
      return {
        to: '/samples/$sampleId' as const,
        params: { sampleId: target.id },
      }
    case 'sheet':
      return {
        to: '/sheets/$sheetId' as const,
        params: { sheetId: target.id },
      }
    default:
      return {
        to: '/records/$recordId' as const,
        params: { recordId: target.id },
      }
  }
}

/**
 * SHELL-02: the bell. Every row opens the record its target names and marks
 * itself read; "Mark all read" is a real write through the RPC the legacy bell
 * uses, so both the list and the bottom-tab badge stay clear after it.
 */
function Notifications({
  items,
  unreadIds,
  onMarkRead,
}: {
  items: Notification[]
  unreadIds: ReadonlySet<string>
  onMarkRead: (ids: string[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unread = unreadIds.size

  async function markRead(ids: string[]): Promise<boolean> {
    setError(null)
    setPending(true)
    try {
      await onMarkRead(ids)
      return true
    } catch {
      setError('The notifications could not be marked read. Try again.')
      return false
    } finally {
      setPending(false)
    }
  }

  /**
   * A row is a link, so its navigation does not wait for the write. The popover
   * closes once the row is read; when the write fails it stays open, because the
   * reason has to be readable where the click was made.
   */
  async function readRow(id: string) {
    if (await markRead([id])) setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="quiet"
            size="icon"
            aria-label={
              unread ? `Notifications, ${unread} unread` : 'Notifications'
            }
            className="relative"
          />
        }
      >
        <Icon name="bell" size={14} />
        {unread ? (
          <span
            aria-hidden="true"
            className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-link ring-2 ring-surface"
          />
        ) : null}
      </PopoverTrigger>
      <PopoverContent className="w-[380px]">
        <div className="flex items-center border-b border-border px-3 py-2.5">
          <PopoverTitle className="flex-1 font-heading text-[14px] font-semibold">
            Notifications
          </PopoverTitle>
          <Button
            variant="quiet"
            size="sm"
            disabled={!unread || pending}
            onClick={() => void markRead([...unreadIds])}
          >
            Mark all read
          </Button>
        </div>
        {error ? (
          <div className="border-b border-border px-3 py-2">
            <Notice tone="bad">{error}</Notice>
          </div>
        ) : null}
        {items.length === 0 ? (
          <p className="px-3 py-2.5 text-label text-fg-muted">
            Nothing new right now.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {items.map((n) => {
              const isUnread = unreadIds.has(n.id)
              return (
                <Link
                  key={n.id}
                  {...notificationLink(n.to)}
                  onClick={() => {
                    // A row that is already read has nothing to write; it still
                    // dismisses, like the ones whose write resolves.
                    if (isUnread) void readRow(n.id)
                    else setOpen(false)
                  }}
                  className="grid grid-cols-[8px_1fr_auto] gap-2.5 border-b border-border-subtle px-3 py-2.5 text-label leading-[17px] text-fg no-underline hover:bg-row-hover hover:text-fg hover:no-underline"
                >
                  {isUnread ? (
                    <span
                      aria-label="Unread"
                      className="mt-[5px] size-[7px] rounded-full bg-link"
                    />
                  ) : (
                    <span />
                  )}
                  <span dangerouslySetInnerHTML={{ __html: n.html }} />
                  <span className="whitespace-nowrap text-fg-muted">
                    {n.when}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
        <div className="bg-surface-muted px-3 py-2 text-label">
          <Link to="/inbox">Open inbox</Link> ·{' '}
          <Link to="/settings">Notification settings</Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

const appearanceClient = createDataClient()

/**
 * EXP-05.5 — the device's offline edit store, created on first use so SSR never
 * opens IndexedDB. Sign-out reads it to record what this device is holding; it
 * must never clear it, because the drafts are what survives.
 */
let deviceOfflineStore: ReturnType<typeof createOfflineEditStore> | null = null
function offlineEditStore() {
  deviceOfflineStore ??= createOfflineEditStore(createIndexedDbStorage())
  return deviceOfflineStore
}

function AccountMenu({ me }: { me: ShellData['me'] }) {
  const { pref, setPref } = useTheme()
  const navigate = useNavigate()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  async function signOut() {
    setSignOutError(null)
    // Reuse the editors' native leave guard before terminating their session.
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    // EXP-05.5: unsynced edits survive sign-out, so being offline is no longer a
    // reason to refuse it. Only an editor with work it has not saved blocks it.
    if (leaving.defaultPrevented) {
      setSignOutError(
        'Save your pending edits before signing out. Your edits have not been discarded.',
      )
      return
    }
    setSigningOut(true)
    try {
      // Record that this device is holding drafts for this user, before the
      // session ends. It never deletes: the drafts are the point.
      await retainDraftsOnSignOut(
        {
          listScopes: (userId) => offlineEditStore().listScopes(userId),
          listDrafts: (scope) => offlineEditStore().listEdits(scope),
        },
        webSignOutRetentionStorage(window.localStorage),
        me.id,
      ).catch(() => undefined)
      const result = await authClient.signOut()
      if (result.error || !result.data.success)
        throw new Error(
          'Sign out failed. Your session has not been confirmed ended. Try again.',
        )
      await router.options.context.queryClient.cancelQueries()
      router.options.context.queryClient.clear()
      await navigate({ to: '/sign-in', search: { state: 'signed-out' } })
      await router.invalidate()
    } catch {
      setSignOutError('Sign out could not be confirmed. Try again.')
    } finally {
      setSigningOut(false)
    }
  }
  // Cache locally for an instant switch and persist the per-user preference;
  // the server value is the source of truth on the next load.
  const choose = (value: ThemePref) => {
    setPref(value)
    void setUserAppearance(appearanceClient, value).catch(() => undefined)
  }
  const opts: [ThemePref, string][] = [
    ['system', 'System'],
    ['light', 'Light'],
    ['dark', 'Dark'],
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Account: ${me.name}`}
            className="cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
        }
      >
        <Avatar initials={me.initials} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[272px]">
        <div className="flex items-center gap-2.5 p-2">
          <Avatar initials={me.initials} />
          <div className="text-label leading-[17px]">
            <div className="text-body font-semibold">{me.name}</div>
            <div className="text-fg-muted">{me.role}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <div className="mb-1 text-[11px] font-medium text-fg-muted">
            Appearance
          </div>
          <div
            role="radiogroup"
            aria-label="Appearance"
            className="grid grid-cols-3 gap-0.5 rounded-md bg-surface-muted p-0.5"
          >
            {opts.map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={pref === v}
                onClick={() => choose(v)}
                className={cn(
                  'h-6 cursor-pointer rounded-sm border-0 bg-transparent text-label text-fg-muted',
                  pref === v &&
                    'bg-surface font-medium text-fg shadow-[0_0_0_1px_var(--border)]',
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem icon="info" render={<Link to="/help" />}>
          Help and shortcuts
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem icon="settings" render={<Link to="/settings" />}>
          Settings
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        {signOutError ? <Notice tone="bad">{signOutError}</Notice> : null}
        <DropdownMenuItem
          icon="signOut"
          disabled={signingOut}
          closeOnClick={false}
          onClick={() => void signOut()}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NavLink({ item }: { item: NavItem }) {
  const homeSelected = useRouterState({
    select: (state) => isHomeSection(state.location.pathname),
  })
  const selectedProps = {
    className: 'bg-selection font-medium hover:bg-selection',
    'aria-current': 'page' as const,
  }
  return (
    <Link
      {...item.link}
      activeOptions={{ exact: item.label === 'Home' }}
      className="flex h-[30px] shrink-0 items-center gap-2 rounded-md px-2 text-body leading-[normal] text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline max-lg:h-11 [&_svg]:text-fg-muted"
      activeProps={selectedProps}
      inactiveProps={
        item.label === 'Home' && homeSelected ? selectedProps : undefined
      }
    >
      <Icon name={item.icon} size={16} />
      {item.label}
      {item.count ? (
        <span className="ml-auto text-label leading-[normal] font-normal text-fg-muted">
          {item.count}
        </span>
      ) : null}
    </Link>
  )
}

function SideNav({
  pinned,
  counts,
  primaryItems,
  recordItems,
  onNavigate,
  className,
}: {
  pinned: ShellData['pinned']
  counts?: ShellData['counts']
  primaryItems: NavItem[]
  recordItems: NavItem[]
  onNavigate?: () => void
  className?: string
}) {
  const withCount = (item: NavItem): NavItem => {
    const live =
      counts?.[
        item.label.toLowerCase() as keyof NonNullable<ShellData['counts']>
      ]
    return live ? { ...item, count: live } : item
  }
  return (
    <nav
      aria-label="Main"
      onClick={(e) => {
        if (onNavigate && (e.target as HTMLElement).closest('a')) onNavigate()
      }}
      className={cn(
        'flex w-nav shrink-0 flex-col gap-px overflow-y-auto border-r border-border bg-surface p-2.5 max-lg:w-full',
        className,
      )}
    >
      {primaryItems.map((i) => (
        <NavLink key={i.label} item={withCount(i)} />
      ))}
      <div className="mx-2 my-1.5 h-px shrink-0 bg-border-subtle" />
      {recordItems.map((i) => (
        <NavLink key={i.label} item={withCount(i)} />
      ))}
      {pinned.length ? (
        <>
          <div className="shrink-0 px-2 pb-1 pt-3.5 text-label leading-[normal] font-medium text-fg-muted">
            Pinned projects
          </div>
          {pinned.map((p) => (
            <Link
              key={p.id}
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="flex h-[30px] shrink-0 items-center gap-2 rounded-md px-2 text-body leading-[normal] text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline"
            >
              <Dot tone={p.tone} className="mx-1" />
              {p.name}
            </Link>
          ))}
        </>
      ) : null}
      <div className="flex-1" />
      <Link
        to="/settings"
        className={cn(
          buttonVariants({ variant: 'quiet' }),
          'h-[30px] justify-start gap-2 px-2 font-normal [&_svg]:text-fg-muted',
        )}
      >
        <Icon name="settings" size={16} />
        Settings
      </Link>
    </nav>
  )
}
