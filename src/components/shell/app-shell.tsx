import { BrandMark } from '#/components/ui/brand-mark'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePlatform } from '#/lib/use-platform'
import { formatShortcut } from '#/lib/shortcuts'
import {
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { Icon } from '#/components/icons'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { Avatar } from '#/components/ui/avatar'
import { Dot } from '#/components/ui/status'
import { Sheet, SheetContent } from '#/components/ui/sheet'
import { Kbd } from '#/components/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { useTheme } from '#/components/lib/theme'
import {
  retainDraftsOnSignOut,
  webSignOutRetentionStorage,
} from '#/lib/offline/retention'
import {
  createIndexedDbStorage,
  createOfflineEditStore,
} from '#/lib/offline/store'
import { clearOfflinePages } from '#/lib/offline/service-worker'
import { createDataClient } from '#/lib/data-client'
import {
  fetchMyProfile,
  fetchUserPreferences,
  myProfileQueryKey,
  setActiveWorkspace,
  setUserAppearance,
  setNavFolded,
  setUserPreference,
} from '#/lib/user-preferences'
import { createGlobalShortcuts } from '#/lib/global-shortcuts'
import type { GlobalShortcutDestination } from '#/lib/global-shortcuts'
import { OPEN_SHORTCUTS_EVENT } from '#/lib/shortcuts-dialog'
import { PageAiWorkspaceProvider } from '#/lib/use-page-ai'
import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import type { ThemePref } from '#/components/lib/theme'
import { cn } from '#/lib/utils'
import type { Notification, NotificationTarget } from '#/components/types'
import type { ShellCounts } from '#/lib/shell-counts.server'
import { markNotificationsRead } from '#/lib/notifications-data'
import { createMenuSearch } from './create-context'
import { isHomePage, navGroups, primaryNav, visibleNavGroups } from './nav'
import type { NavGroup, NavItem } from './nav'
import { filterNavForRole } from '#/lib/nav-visibility'
import { settingsHomePath } from '#/components/settings/settings-nav'
import type { SettingsAccessMap } from '#/lib/settings-access'
import { Tooltip } from '#/components/ui/tooltip'
import {
  LazySearchPalette,
  LazyShortcutsDialog,
} from '#/components/shell/lazy-overlays'
import { ContextHelp } from '#/components/help/context-help'
import { useEdgeSwipeOpen, useSwipeToClose } from '#/lib/pwa/edge-swipe'
import { InstallPrompt } from '#/components/pwa/install-prompt'
import { AssistantTrigger } from '#/components/assist/ask-ai-button'
import { AssistantPanel } from '#/components/assist/assistant-panel'
import { authClient } from '#/lib/auth-client'
import { Notice } from '#/components/ui/alert'
import { listDemoPersonasFn } from '#/lib/demo-persona-data'
import { writeViewAsCookie } from '#/lib/demo-persona'
import { WORKSPACE_ROLE_LABELS } from '#/lib/workspace-admin'
import { requestWorkspaceLeave } from '#/components/workspace/workspace-navigation'
import {
  applyAppBadge,
  disablePush,
  syncPushSubscription,
} from '#/lib/push-client'
import { t } from '#/copy'

const SIDEBAR_COLLAPSE_KEY = 'sheetbase-sidebar-collapsed'
const SIDEBAR_FOLDED_KEY = 'sheetbase-sidebar-folded'

function readFolded(): string[] {
  try {
    const raw = localStorage.getItem(SIDEBAR_FOLDED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter((g): g is string => typeof g === 'string')
      : []
  } catch {
    return []
  }
}

function writeFolded(groups: readonly string[]) {
  try {
    localStorage.setItem(SIDEBAR_FOLDED_KEY, JSON.stringify(groups))
  } catch {
    /* private mode / disabled storage */
  }
}

/** The `G` then key destinations the design lists (plus the real routes). */
const G_DESTINATIONS: GlobalShortcutDestination[] = [
  { key: 'h', to: '/', label: t('settings.shell.appShell.home') },
  { key: 'i', to: '/inbox', label: t('settings.shell.appShell.inbox') },
  {
    key: 'e',
    to: '/experiments',
    label: t('settings.shell.appShell.experiments'),
  },
  { key: 'p', to: '/projects', label: t('settings.shell.appShell.projects') },
  { key: 'a', to: '/samples', label: t('settings.shell.appShell.samples') },
  { key: 'd', to: '/datasets', label: t('settings.shell.appShell.datasets') },
]

type ShellData = {
  me: {
    id: string
    name: string
    initials: string
    role: string
    settingsAccess?: SettingsAccessMap
    /** The demo has no sign-in, so the menu offers "View as" instead. */
    authFree?: boolean
  }
  notifications: Notification[]
  pinned: { id: string; name: string; tone: 'progress' | 'review' }[]
  /** Pages the lab took out of everyone's sidebar. */
  hiddenPages?: string[]
  /** Live counts keyed by nav label: Inbox, Datasets, Pipelines. */
  counts?: ShellCounts
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
  banner,
  workspaceMenuExtra,
  children,
}: {
  data: ShellData
  /** A page-wide strip under the top bar, e.g. the offer to join a lab. */
  banner?: React.ReactNode
  /** Extra rows at the foot of the workspace menu. */
  workspaceMenuExtra?: React.ReactNode
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const theme = useTheme()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [search, setSearch] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  /** Phone only: the navigation opens as a drawer, since there is no room for a rail. */
  const [navOpen, setNavOpen] = useState(false)
  /** SHELL-01/03: a toggle the user has already made outranks the slower fetch. */
  const collapseTouched = useRef(false)
  /**
   * SHELL-02: the ids marked read in this session. The bell's rows come from the
   * server snapshot, so the action has to be remembered here until the shell
   * re-resolves — otherwise the rows revert to unread on the next render.
   */
  const [readNotifications, setReadNotifications] = useState<
    ReadonlySet<string>
  >(() => new Set())

  // SHELL-01.2: omit navigation a workspace role cannot open. Everyday
  // scientific items declare no `roles`/`capability`, so they stay visible.
  const role = data.me.role
  const settingsTo = settingsHomePath(role, data.me.settingsAccess)
  const primaryItems = useMemo(() => filterNavForRole(primaryNav, role), [role])
  const hiddenPages = data.hiddenPages
  const groups = useMemo(
    () =>
      visibleNavGroups(
        navGroups.map((g) => ({
          ...g,
          items: filterNavForRole(g.items, role),
        })),
        hiddenPages ?? [],
      ),
    [role, hiddenPages],
  )
  /** The sidebar groups this person folded; follows them between devices. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const foldTouched = useRef(false)
  const toggleFold = useCallback((group: string) => {
    foldTouched.current = true
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      const list = [...next].sort()
      writeFolded(list)
      void setNavFolded(createDataClient(), list).catch(() => undefined)
      return next
    })
  }, [])

  // A swipe in from the left edge opens the phone drawer.
  const openNav = useCallback(() => setNavOpen(true), [])
  useEdgeSwipeOpen(openNav)
  const drawerSwipe = useSwipeToClose(() => setNavOpen(false))

  // The drawer closes on navigation, whichever link was tapped.
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  // SHELL-01/03: the sidebar collapse is a per-user preference.
  useEffect(() => {
    let saved = false
    try {
      saved = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1'
    } catch {
      /* private mode / disabled storage */
    }
    setCollapsed(saved)
    setFolded(new Set(readFolded()))
    let cancelled = false
    void fetchUserPreferences(createDataClient())
      .then((preferences) => {
        if (cancelled || !preferences) return
        if (!foldTouched.current) {
          const stored = preferences.navFolded
          setFolded(new Set(stored))
          writeFolded(stored)
        }
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
      if (!(await requestWorkspaceLeave()))
        throw new Error(t('settings.shell.appShell.savePendingEdits'))
      await setActiveWorkspace(createDataClient(), workspaceId)
      clearOfflinePages()
      await router.options.context.queryClient.cancelQueries()
      router.options.context.queryClient.clear()
      // The page being looked at belongs to the workspace just left, so the
      // person lands on the new workspace's Home rather than a page that may
      // not exist there.
      await router.navigate({ to: '/', ignoreBlocker: true })
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

  // The installed app's icon shows how many things are unread, and this device
  // tells the server who is signed in so phone alerts reach the right person.
  useEffect(() => {
    applyAppBadge(unreadIds.size)
  }, [unreadIds.size])
  useEffect(() => {
    void syncPushSubscription()
  }, [])

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
    <PageAiWorkspaceProvider value={data.workspace?.id ?? null}>
      <ShortcutProvider definitions={globalShortcuts}>
        <div className="flex h-[calc(100dvh-var(--session-banner-h,0px))] mt-[var(--session-banner-h,0px)] flex-col">
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
          >
            {t('settings.shell.appShell.skipContent')}
          </a>
          <TopBar
            data={data}
            unreadIds={unreadIds}
            onMarkNotificationsRead={markNotifications}
            onSearch={() => setSearch(true)}
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
            onSwitchWorkspace={switchWorkspace}
            workspaceMenuExtra={workspaceMenuExtra}
            navCollapsed={collapsed}
            onToggleNav={toggleCollapsed}
            onOpenNav={() => setNavOpen(true)}
          />
          {banner}
          <InstallPrompt />
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetContent
              side="left"
              title={
                <span className="inline-flex items-center gap-2">
                  <BrandMark size={22} />
                  {t('settings.shell.appShell.sheetbase')}
                </span>
              }
              className="md:hidden"
              {...drawerSwipe}
            >
              <SideNav
                pinned={data.pinned}
                counts={data.counts}
                primaryItems={primaryItems}
                groups={groups}
                folded={folded}
                onToggleFold={toggleFold}
                settingsTo={settingsTo}
                className="min-h-full w-full! border-r-0"
              />
            </SheetContent>
          </Sheet>
          <div className="flex min-h-0 flex-1">
            {/* SHELL-01: one sidebar from tablet width up. It is the icon rail
              where there is no room for the full navigation or when the user
              has minimised it, and the full sidebar otherwise — same items,
              same order, same place. On a phone a 48px rail costs an eighth of
              the screen, so there the same sidebar opens as a drawer from the
              menu button in the header. */}
            <NavRail
              className={
                collapsed ? 'hidden md:flex' : 'hidden md:flex xl:hidden'
              }
              primaryItems={primaryItems}
              groups={groups}
              settingsTo={settingsTo}
            />
            {collapsed ? null : (
              <SideNav
                pinned={data.pinned}
                counts={data.counts}
                primaryItems={primaryItems}
                groups={groups}
                folded={folded}
                onToggleFold={toggleFold}
                settingsTo={settingsTo}
                className="hidden xl:flex"
              />
            )}
            <main id="main" className="flex min-w-0 flex-1 bg-background">
              {children}
            </main>
          </div>
          <LazySearchPalette
            open={search}
            onOpenChange={setSearch}
            role={data.me.role}
            pathname={pathname}
          />
          <LazyShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
          <AssistantPanel
            workspaceId={data.workspace?.id ?? null}
            role={data.me.role}
          />
        </div>
      </ShortcutProvider>
    </PageAiWorkspaceProvider>
  )
}

function NavRail({
  className,
  primaryItems,
  groups,
  settingsTo,
}: {
  className?: string
  primaryItems: NavItem[]
  groups: NavGroup[]
  settingsTo: string
}) {
  const homeSelected = useRouterState({
    select: (state) => isHomePage(state.location.pathname),
  })
  const selectedProps = {
    className: 'bg-selection text-fg!',
    'aria-current': 'page' as const,
  }
  return (
    <nav
      aria-label={t('settings.shell.appShell.mainAria')}
      className={cn(
        'w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-border bg-surface py-2',
        className,
      )}
    >
      {[...primaryItems, ...groups.flatMap((g) => [null, ...g.items])].map(
        (i, n) =>
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
      <Tooltip content={t('settings.shell.appShell.settingsTooltip')}>
        <Link
          to={settingsTo}
          aria-label={t('settings.shell.appShell.settingsAria')}
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
  // A top-level destination (Home, Inbox, Experiments, ...) is one segment deep
  // and reached from the drawer, so there is nowhere to go back to.
  if (pathname.split('/').filter(Boolean).length <= 1) return null
  return (
    <IconButton
      variant="quiet"
      icon="arrowLeft"
      label={t('common.actions.back')}
      onClick={() => router.history.back()}
      className="md:hidden"
    />
  )
}

function TopBar({
  data,
  unreadIds,
  onMarkNotificationsRead,
  onSearch,
  createOpen,
  onCreateOpenChange,
  onSwitchWorkspace,
  workspaceMenuExtra,
  navCollapsed,
  onToggleNav,
  onOpenNav,
}: {
  data: ShellData
  unreadIds: ReadonlySet<string>
  onMarkNotificationsRead: (ids: string[]) => Promise<void>
  onSearch: () => void
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
  onSwitchWorkspace: (workspaceId: string) => Promise<void>
  workspaceMenuExtra?: React.ReactNode
  navCollapsed: boolean
  onToggleNav: () => void
  onOpenNav: () => void
}) {
  const platform = usePlatform()
  return (
    // WCAG 1.4.10: below `md` the controls must all fit the 44px row at 320.
    // The brand link gives way to the menu button, help and the assistant sit
    // in other places, and the workspace name is the one control that shrinks
    // (it truncates), so nothing is clipped and the bar never wraps.
    <header className="flex h-topbar shrink-0 standalone:box-content standalone:pt-[env(safe-area-inset-top)] items-center gap-2 border-b border-border bg-surface px-2 max-md:border-transparent max-md:bg-background md:gap-3 md:px-3">
      <IconButton
        variant="quiet"
        icon="panelLeft"
        label={t('settings.shell.appShell.openNavigation')}
        aria-haspopup="dialog"
        onClick={onOpenNav}
        className="md:hidden"
      />
      {/* SHELL-01: it minimises the sidebar to the icon rail and expands it
          again — the sidebar itself never moves and never becomes a drawer.
          The full sidebar only renders from `xl` up, so below that breakpoint
          the control has nothing to minimise and is hidden rather than
          claiming a state the frame cannot show. */}
      <IconButton
        variant="quiet"
        icon="panelLeft"
        label={
          navCollapsed
            ? t('settings.shell.appShell.expandNavigation')
            : t('settings.shell.appShell.minimiseNavigation')
        }
        aria-keyshortcuts="Control+\\ Meta+\\"
        onClick={onToggleNav}
        className="max-xl:hidden"
      />
      {/* MOB-01.1: on a phone the header carries a back button, because the
          sidebar that would otherwise show where you came from is hidden. It is
          absent on the top-level destinations, where there is nowhere to go back
          to. */}
      <PhoneBackButton />
      <Link
        to="/"
        className="flex shrink-0 items-center gap-2 max-md:hidden xl:w-[208px] font-display text-[15px] leading-[normal] font-semibold text-fg no-underline hover:text-fg hover:no-underline"
      >
        <BrandMark size={22} />
        <span className="max-md:sr-only">
          {t('settings.shell.appShell.sheetbase')}
        </span>
      </Link>
      <WorkspaceSwitcher
        workspace={data.workspace ?? null}
        workspaces={data.workspaces ?? []}
        onSwitch={onSwitchWorkspace}
        extra={workspaceMenuExtra}
        className="flex min-w-0 shrink max-md:flex-1 max-md:justify-start"
      />
      {/* The phone search button is `size-10` below `md`, so the container keeps
          room for it: squeezed below its content the icon overflowed the box
          (justify-end) and painted over the brand link. */}
      <div className="flex min-w-0 justify-end max-md:shrink-0 md:flex-1 md:justify-center">
        <IconButton
          variant="quiet"
          icon="search"
          label={t('common.actions.search')}
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
          <span className="flex-1 truncate">
            {t('common.actions.search')}
            <span className="max-xl:hidden">
              {' '}
              {t('settings.shell.appShell.experimentsSamplesDatasets')}
            </span>
          </span>
          <Kbd>{formatShortcut('mod+k', platform)}</Kbd>
        </button>
      </div>
      <NewMenu open={createOpen} onOpenChange={onCreateOpenChange} />
      <AssistantTrigger />
      <ContextHelp />
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
 * staying on the old workspace. There is no phone drawer, so the trigger is
 * visible at every width: it is the one place the shell chrome names the active
 * workspace.
 *
 * There is no non-membership entry: a workspace is provisioned by its owner, and
 * no surface in the product creates one from here.
 */
function WorkspaceSwitcher({
  workspace,
  workspaces,
  onSwitch,
  extra,
  className,
}: {
  workspace: { id: string; name: string } | null
  workspaces: { id: string; name: string }[]
  onSwitch: (workspaceId: string) => Promise<void>
  extra?: React.ReactNode
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
      setError(t('settings.shell.appShell.workspaceCouldOpened'))
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
            aria-label={t('settings.shell.appShell.switchWorkspaceAria')}
            className={cn(
              'max-w-52 gap-1.5',
              className ?? 'flex min-w-16 shrink',
            )}
          />
        }
      >
        {/* A phone has no room for the name beside four buttons, and cut to
            "Process Deve…" it named nothing; it shows the workspace's initials
            instead, and the menu names it in full. */}
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-muted text-[11px] font-semibold tracking-wide text-fg md:hidden"
        >
          {workspaceInitials(
            workspace?.name ?? t('settings.shell.appShell.workspace'),
          )}
        </span>
        {/* `truncate` only ellipsizes a flex child that is allowed to shrink;
            without the floor the name forced the whole bar wider. */}
        <span className="min-w-0 truncate max-md:sr-only">
          {workspace?.name ?? t('settings.shell.appShell.workspace')}
        </span>
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
          <DropdownMenuLabel>
            {t('settings.shell.appShell.workspaces')}
          </DropdownMenuLabel>
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
          {extra}
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

/** Up to two initials for a workspace name: "Process Development" → "PD". */
export function workspaceInitials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_/]+/)
    .filter(Boolean)
  const letters =
    words.length > 1
      ? [words[0], words[words.length - 1]].map((word) => [...word][0])
      : [...(words[0] ?? '')].slice(0, 2)
  return letters.join('').toUpperCase()
}

function NewMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // The create routes prefill whatever the page behind this menu is about.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const search = createMenuSearch(pathname)
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="primary"
            icon="plus"
            aria-label={t('common.actions.new')}
            // On a phone it is one icon among the header's icons: the same
            // 40px round target, not a wider block.
            className="max-md:size-10 max-md:rounded-full max-md:px-0"
          />
        }
      >
        <span className="max-md:hidden">{t('common.actions.new')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuLinkItem
          icon="flask"
          hint="E"
          render={<Link to="/experiments/new" search={search.experiment} />}
        >
          {t('settings.shell.appShell.experiment')}
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          icon="tube"
          hint="S"
          render={<Link to="/samples" search={search.sample} />}
        >
          {t('settings.shell.appShell.sample')}
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          icon="folder"
          render={<Link to="/projects" search={{ new: true }} />}
        >
          {t('settings.shell.appShell.project')}
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          icon="table"
          render={<Link to="/sheets/new" search={search.sheet} />}
        >
          {t('settings.shell.appShell.workingSheet')}
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          icon="chart"
          render={<Link to="/analysis/new" search={{ mode: 'chart' }} />}
        >
          {t('settings.shell.appShell.analysis')}
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem
          icon="upload"
          hint="I"
          render={<Link to="/import" search={search.import} />}
        >
          {t('settings.shell.appShell.importData')}
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('settings.shell.appShell.labLibrary')}
          </DropdownMenuLabel>
          <DropdownMenuLinkItem
            icon="box"
            render={<Link to="/materials" search={{ new: true }} />}
          >
            {t('settings.shell.appShell.materialLot')}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            icon="plug"
            render={<Link to="/instruments" search={{ new: true }} />}
          >
            {t('settings.shell.appShell.instrument')}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            icon="template"
            render={<Link to="/templates" search={{ new: true }} />}
          >
            {t('settings.shell.appShell.template')}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            icon="protocol"
            render={<Link to="/protocols" search={{ new: true }} />}
          >
            {t('settings.shell.appShell.protocol')}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            icon="pipeline"
            render={<Link to="/pipelines" search={{ new: true }} />}
          >
            {t('settings.shell.appShell.pipeline')}
          </DropdownMenuLinkItem>
          <DropdownMenuLinkItem
            icon="schema"
            render={<Link to="/models" search={{ create: true }} />}
          >
            {t('settings.shell.appShell.model')}
          </DropdownMenuLinkItem>
        </DropdownMenuGroup>
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
      setError(t('settings.shell.appShell.notificationsCouldMarked'))
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
              unread
                ? t('settings.shell.appShell.notificationsUnread', { unread })
                : t('settings.shell.appShell.notificationsLabel')
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
            {t('settings.shell.appShell.notifications')}
          </PopoverTitle>
          <Button
            variant="quiet"
            size="sm"
            disabled={!unread || pending}
            onClick={() => void markRead([...unreadIds])}
          >
            {t('settings.shell.appShell.markRead')}
          </Button>
        </div>
        {error ? (
          <div className="border-b border-border px-3 py-2">
            <Notice tone="bad">{error}</Notice>
          </div>
        ) : null}
        {items.length === 0 ? (
          <p className="px-3 py-2.5 text-label text-fg-muted">
            {t('settings.shell.appShell.nothingNewRight')}
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
                      aria-label={t('settings.shell.appShell.unreadAria')}
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
          <Link to="/inbox">{t('settings.shell.appShell.openInbox')}</Link> ·{' '}
          <Link to="/settings/account/notifications">
            {t('settings.shell.appShell.notificationSettings')}
          </Link>
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

/** Demo only: switch to a teammate so review and signing can be shown. */
function ViewAsSection({ currentId }: { currentId: string }) {
  const people = useQuery({
    queryKey: ['demo-personas'],
    queryFn: () => listDemoPersonasFn(),
    staleTime: 60_000,
  })
  if (!people.data || people.data.length < 2) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>
          {t('settings.shell.appShell.viewAs')}
        </DropdownMenuLabel>
        <div className="max-h-80 overflow-y-auto">
          {people.data.map((person) => (
            <DropdownMenuItem
              key={person.id}
              icon={person.id === currentId ? 'check' : undefined}
              hint={
                (WORKSPACE_ROLE_LABELS as Record<string, string>)[
                  person.role
                ] ?? person.role
              }
              onClick={() => {
                writeViewAsCookie(person.id)
                window.location.reload()
              }}
            >
              {person.name}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuGroup>
    </>
  )
}

function AccountMenu({ me }: { me: ShellData['me'] }) {
  // The initials you set in your profile, once read; until then (and with no
  // signed-in user) the ones derived from your name.
  const profile = useQuery({
    queryKey: myProfileQueryKey,
    queryFn: () => fetchMyProfile(appearanceClient),
    enabled: Boolean(me.id),
    staleTime: 5 * 60_000,
  })
  const initials = profile.data?.initials || me.initials
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
      setSignOutError(t('settings.shell.appShell.savePendingEdits'))
      return
    }
    if (!(await requestWorkspaceLeave())) {
      setSignOutError(t('settings.shell.appShell.signOutCancelled'))
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
      // This phone stops getting this person's alerts the moment they leave.
      await disablePush().catch(() => undefined)
      applyAppBadge(0)
      const result = await authClient.signOut()
      if (result.error || !result.data.success)
        throw new Error(t('settings.shell.appShell.signOutFailed'))
      await router.options.context.queryClient.cancelQueries()
      router.options.context.queryClient.clear()
      await navigate({
        to: '/sign-in',
        search: { state: 'signed-out' },
        ignoreBlocker: true,
      })
      await router.invalidate()
    } catch {
      setSignOutError(t('settings.shell.appShell.signOutNotConfirmed'))
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
    ['system', t('settings.shell.appShell.themeSystem')],
    ['light', t('settings.shell.appShell.themeLight')],
    ['dark', t('settings.shell.appShell.themeDark')],
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={t('settings.shell.appShell.accountAria', {
              name: me.name,
            })}
            className="cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
        }
      >
        <Avatar initials={initials} userId={me.id || undefined} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[272px]">
        <div className="flex items-center gap-2.5 p-2">
          <Avatar initials={initials} userId={me.id || undefined} />
          <div className="text-label leading-[17px]">
            <div className="text-body font-semibold">{me.name}</div>
            <div className="text-fg-muted">{me.role}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <div className="mb-1 text-[11px] font-medium text-fg-muted">
            {t('settings.shell.appShell.appearance')}
          </div>
          <div
            role="radiogroup"
            aria-label={t('settings.shell.appShell.appearance')}
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
        {me.authFree ? <ViewAsSection currentId={me.id} /> : null}
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem icon="info" render={<Link to="/help" />}>
          {t('settings.shell.appShell.helpShortcuts')}
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          icon="settings"
          render={<Link to={settingsHomePath(me.role, me.settingsAccess)} />}
        >
          {t('settings.shell.appShell.settingsAria')}
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        {signOutError ? <Notice tone="bad">{signOutError}</Notice> : null}
        <DropdownMenuItem
          icon="signOut"
          disabled={signingOut}
          closeOnClick={false}
          onClick={() => void signOut()}
        >
          {signingOut
            ? t('settings.shell.appShell.signingOut')
            : t('settings.shell.appShell.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The fold key for the pinned projects, beside the page groups' keys. */
const PINNED_GROUP = 'pinned'

/** A sidebar group heading that folds and unfolds the group under it. */
function FoldHeading({
  label,
  folded,
  onToggle,
}: {
  label: string
  folded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={!folded}
      aria-label={t(
        folded
          ? 'settings.shell.nav.unfoldGroup'
          : 'settings.shell.nav.foldGroup',
        { group: label },
      )}
      onClick={onToggle}
      className="group/fold flex h-[26px] shrink-0 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-2 pt-2.5 pb-1 text-left text-label leading-[normal] font-medium text-fg-muted hover:text-fg"
    >
      {label}
      <Icon
        name={folded ? 'chevronRight' : 'chevronDown'}
        size={12}
        className="opacity-60 group-hover/fold:opacity-100"
      />
    </button>
  )
}

function NavLink({ item }: { item: NavItem }) {
  const homeSelected = useRouterState({
    select: (state) => isHomePage(state.location.pathname),
  })
  const selectedProps = {
    className: 'bg-selection font-medium hover:bg-selection',
    'aria-current': 'page' as const,
  }
  return (
    <Link
      {...item.link}
      activeOptions={{ exact: item.label === 'Home' }}
      className="flex h-[30px] shrink-0 items-center gap-2 rounded-md px-2 text-body leading-[normal] text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline [&_svg]:text-fg-muted"
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
  groups,
  folded,
  onToggleFold,
  settingsTo,
  className,
}: {
  pinned: ShellData['pinned']
  counts?: ShellData['counts']
  primaryItems: NavItem[]
  groups: NavGroup[]
  /** The groups this person folded. */
  folded: ReadonlySet<string>
  onToggleFold: (group: string) => void
  settingsTo: string
  className?: string
}) {
  const withCount = (item: NavItem): NavItem => {
    const live =
      counts?.[
        item.label.toLowerCase() as keyof NonNullable<ShellData['counts']>
      ]
    // Only a number is a number: an unknown count (`null` — the read failed,
    // see `shell-counts.server.ts`) renders no number at all, rather than a
    // zero the server could not back, while the counts that did read still show.
    return typeof live === 'string' ? { ...item, count: live } : item
  }
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isOpen = (item: NavItem) => {
    const to = String(item.link.to)
    return pathname === to || pathname.startsWith(`${to}/`)
  }
  return (
    <nav
      aria-label={t('settings.shell.appShell.mainAria')}
      className={cn(
        'flex w-nav shrink-0 flex-col gap-px overflow-y-auto border-r border-border bg-surface p-2.5',
        className,
      )}
    >
      {primaryItems.map((i) => (
        <NavLink key={i.label} item={withCount(i)} />
      ))}
      {groups.map((g) => {
        const isFolded = folded.has(g.key)
        // A folded group still shows the page you are on, so the sidebar
        // never loses track of where you are.
        const items = isFolded ? g.items.filter(isOpen) : g.items
        return (
          <div
            key={g.key}
            role="group"
            aria-label={g.label}
            className="contents"
          >
            <FoldHeading
              label={g.label}
              folded={isFolded}
              onToggle={() => onToggleFold(g.key)}
            />
            {items.map((i) => (
              <NavLink key={i.label} item={withCount(i)} />
            ))}
          </div>
        )
      })}
      <Link
        to={settingsTo}
        className="flex h-[30px] shrink-0 items-center gap-2 rounded-md px-2 text-body leading-[normal] text-fg no-underline hover:bg-surface-hover hover:text-fg hover:no-underline [&_svg]:text-fg-muted"
        activeProps={{
          className: 'bg-selection font-medium hover:bg-selection',
          'aria-current': 'page',
        }}
      >
        <Icon name="settings" size={16} />
        {t('settings.shell.appShell.settingsAria')}
      </Link>
      {pinned.length ? (
        <div
          role="group"
          aria-label={t('settings.shell.appShell.pinnedProjects')}
          className="contents"
        >
          <FoldHeading
            label={t('settings.shell.appShell.pinnedProjects')}
            folded={folded.has(PINNED_GROUP)}
            onToggle={() => onToggleFold(PINNED_GROUP)}
          />
          {folded.has(PINNED_GROUP)
            ? null
            : pinned.map((p) => (
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
        </div>
      ) : null}
    </nav>
  )
}
