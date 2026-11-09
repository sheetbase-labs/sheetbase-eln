import * as React from 'react'
import { startOfflineSupport } from '#/lib/offline/service-worker'
import { splashLinks, THEME_COLOURS } from '#/lib/pwa/splash'
import { setDisplayTimeZone } from '#/lib/display-time-zone'
import { setDisplayClock } from '#/lib/display-clock'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useMatches,
  useRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { LiveEventProvider } from '../components/live'
import { ShellProvider } from '../components/shell'
import { StepTimersHost } from '#/components/notebook/step-timer'
import { AppShell as V3AppShell } from '#/components/shell/app-shell'
import { AvatarPhotosProvider } from '#/lib/avatar-photos'
import {
  JoinOfferBanner,
  JoinOfferMenuItem,
} from '#/components/shell/join-offer-banner'
import { WorkspaceHost } from '#/components/workspace/workspace-host'
import { SessionExpiredBanner } from '#/components/shell/session-expired-banner'
import { AccessBlocked } from '#/components/shell/access-blocked'
import { Toaster } from '#/components/ui/sonner'
import { ChangeReasonDialog } from '#/components/shell/change-reason-dialog'
import { DevToolbar } from '#/components/dev-toolbar/dev-toolbar'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import { CollaborationEnabledContext } from '#/lib/collaboration/collaboration-enabled'
import { DemoSigningContext } from '#/lib/demo-signing'
import { createServerFn } from '@tanstack/react-start'

import appCss from '../styles.css?url'

import { ThemeProvider } from '../components/theme-provider'

import type { QueryClient } from '@tanstack/react-query'
import type { CurrentContext } from '#/lib/current-user'
import type { ShellCounts } from '#/lib/shell-counts.server'
import type { ShellPinned } from '#/lib/shell-chrome.server'
import type { Notification } from '#/components/types'
import { parseThemeCookie, themeScript } from '#/lib/theme-cookie'
import { FAVICON_LIGHT_UI, faviconScript } from '#/lib/favicon'
import type { ThemePref } from '#/lib/theme-cookie'
import { clientPortalRedirect } from '#/lib/client-portal-only'
import { capabilitiesFromEnv } from '#/lib/capabilities'
import {
  ROOT_CONTEXT_QUERY_KEY,
  ROOT_CONTEXT_STALE_MS,
} from '#/lib/root-context-cache'
import type { Capabilities } from '#/lib/capabilities'
import { t } from '#/copy'

export interface RouterContext {
  workspacePane?: boolean
  queryClient: QueryClient
  auth: CurrentContext | null
  shellCounts: ShellCounts
  shellPinned: ShellPinned[]
  /** Pages the lab took out of everyone's sidebar. */
  shellHiddenPages: string[]
  shellNotifications: Notification[]
  themePref: ThemePref
  /** The lab logo's version (the `?v=` of `/api/workspace-logo`); null when there is none. */
  labLogo: string | null
  /** R5-SHELL-03: the deployment's capability flags, resolved once per request. */
  capabilities: Capabilities
}

// Fetch the deployment context (auth, capability flags) once at the root so
// every child route can read it from the router context without each making its
// own server round-trip.
// The dynamic imports inside the handler are server-only — TanStack
// Start's import protection allows them because the handler never runs
// in the client bundle.
const getAuthContextFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const headers = getRequestHeaders()
  // R5-SHELL-02: the appearance preference is a cookie the server can read, so
  // the root document renders the person's theme on the first paint. An absent
  // or unknown cookie resolves to System, never to a stored default.
  const themePref = parseThemeCookie(headers.get('cookie')) ?? 'system'
  const { getCurrentContext } = await import('#/lib/current-user')
  const capabilities = capabilitiesFromEnv()
  const context = await getCurrentContext(headers)
  const { labLogoVersion } = await import('#/lib/lab-logo.server')

  if (!context?.workspace)
    return {
      context,
      capabilities,
      counts: {},
      pinned: [],
      hiddenPages: [],
      notifications: [],
      themePref,
      labLogo: await labLogoVersion(null),
    }
  const { getShellCounts } = await import('#/lib/shell-counts.server')

  const { getShellPinned, getShellNotifications, getShellHiddenPages } =
    await import('#/lib/shell-chrome.server')

  const [counts, pinned, notifications, hiddenPages, labLogo] =
    await Promise.all([
      getShellCounts(context.workspace.id, context.user.id),
      getShellPinned(context.workspace.id, context.user.id),
      getShellNotifications(context.workspace.id, context.user.id),
      getShellHiddenPages(context.workspace.id),
      labLogoVersion(context.workspace.id),
    ])

  return {
    context,
    capabilities,
    counts,
    pinned,
    hiddenPages,
    notifications,
    themePref,
    labLogo,
  }
})

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        // maximum-scale=1 stops iOS zooming into a focused field, so fields
        // can keep the same type size as the rest of the UI.
        content:
          'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
      },
      {
        title: t('settings.root.sheetbase'),
      },
      {
        name: 'theme-color',
        content: THEME_COLOURS.light,
        media: '(prefers-color-scheme: light)',
      },
      {
        name: 'theme-color',
        content: THEME_COLOURS.dark,
        media: '(prefers-color-scheme: dark)',
      },
      // Paints the page canvas dark before the stylesheet arrives, so a
      // dark-mode launch never flashes white between splash and app.
      { name: 'color-scheme', content: 'light dark' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Sheetbase' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      {
        name: 'description',
        content: t('settings.root.preciseFlexibleElectronic'),
      },
    ],
    links: [
      // PNG fallbacks first for browsers without SVG favicons, picked by the
      // browser's light/dark setting; the SVG last so browsers that support
      // it prefer it. `faviconScript` swaps the SVG to match the tab strip.
      {
        rel: 'icon',
        href: '/favicon-32.png',
        type: 'image/png',
        sizes: '32x32',
        media: '(prefers-color-scheme: light)',
      },
      {
        rel: 'icon',
        href: '/favicon-dark-32.png',
        type: 'image/png',
        sizes: '32x32',
        media: '(prefers-color-scheme: dark)',
      },
      {
        rel: 'icon',
        href: FAVICON_LIGHT_UI,
        type: 'image/svg+xml',
        suppressHydrationWarning: true,
      },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      ...splashLinks(),
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  // LIVE-003: mount the live-event coordinator once for the whole
  // session. The coordinator opens `/api/events` in the browser (after
  // hydration) and reconciles durable change events into the shared
  // QueryClient. It degrades to `offline` on public routes where the
  // stream returns 401; no false `live` state.
  component: RootRouteComponent,
  shellComponent: RootDocument,
  beforeLoad: async ({ context, location }) => {
    if (context.workspacePane) return context

    const {
      context: auth,
      capabilities,
      counts: shellCounts,
      pinned,
      hiddenPages,
      notifications,
      themePref,
      labLogo,
    } = typeof window === 'undefined'
      ? await getAuthContextFn()
      : await context.queryClient.fetchQuery({
          queryKey: ROOT_CONTEXT_QUERY_KEY,
          queryFn: () => getAuthContextFn(),
          staleTime: ROOT_CONTEXT_STALE_MS,
        })

    setDisplayTimeZone(auth?.timeZone)
    setDisplayClock(auth?.clock)

    const toPortal = clientPortalRedirect(
      auth?.workspace?.role,
      location.pathname,
    )

    if (toPortal) throw redirect(toPortal)

    return {
      auth,
      capabilities,
      shellCounts,
      shellPinned: pinned,
      shellHiddenPages: hiddenPages,
      shellNotifications: notifications,
      themePref,
      labLogo,
    }
  },
})

/**
 * LIVE-003: wraps every route in the live-event coordinator so the
 * SSE stream to `/api/events` lives for the whole session.
 *
 * TanStack Router renders nested matches through `<Outlet />` — route
 * components are called with no props, so `children` would be `undefined`
 * and the matched route would never appear. The `<Outlet />` surfaces the
 * active child route (e.g. `/sign-in`) inside the provider.
 */
function RootRouteComponent() {
  const context = Route.useRouteContext()

  return context.workspacePane ? <Outlet /> : <AppRoot />
}

function AppRoot() {
  const resolvedRootContext = Route.useRouteContext()

  const {
    auth,
    shellCounts,
    shellPinned,
    shellHiddenPages,
    shellNotifications,
  } = resolvedRootContext

  // Hydration restores the dehydrated route context without re-running
  // `beforeLoad`, so the first browser render sets the display zone here. It
  // is a no-op when `beforeLoad` already did.
  setDisplayTimeZone(auth?.timeZone)
  setDisplayClock(auth?.clock)

  // Offline: register the service worker once signed in, so the app opens
  // without a connection and queued edits can sync in the background.
  const signedIn = Boolean(auth)
  React.useEffect(() => {
    if (!signedIn) return
    let stop: (() => void) | undefined
    let cancelled = false
    void startOfflineSupport().then((cleanup) => {
      if (cancelled) cleanup()
      else stop = cleanup
    })

    return () => {
      cancelled = true
      stop?.()
    }
  }, [signedIn])

  // R5-SHELL-01: the adopted (v3) shell is the default for every route, so a
  // new product route cannot silently appear without product navigation. Only
  // these recorded internal reference routes keep the legacy ShellProvider
  // wrapper, and the routes with their own chrome render bare. This replaced
  // the hand-maintained allow-list of ported route ids, whose "any matched
  // ancestor" semantics made most entries redundant and its gaps invisible.
  const legacyShellRouteIds = [
    // The operator documents rendered from docs/*.md (deployment, recovery,
    // security, …). Reference material, not product navigation.
    '/docs/$name',
    // The legacy component gallery: it renders the pre-port kit
    // (src/components/scientific, record, notebook) and is not in product nav.
    '/foundations',
    // The printed-label redirect shim: it renders only while resolving the
    // identifier, then replaces the location with the ported record route.
    '/r/$identifier',
    // The development-only grid demo. It redirects to `/` in production and
    // carries no business data.
    '/sheetbase-components',
  ]

  // Routes with their own chrome (the client portal, ADR-0049) render without
  // either shell: no internal navigation and no workspace data.
  const bareRouteIds = [
    '/client-portal',
    '/sign-in',
    '/sign-in_/two-factor',
    '/accept-invitation',
    '/confirm-email-change',
  ]

  const matches = useMatches()

  const bareRoute = matches.some((match) =>
    bareRouteIds.includes(match.routeId),
  )

  const legacyShell = matches.some((match) =>
    legacyShellRouteIds.includes(match.routeId),
  )

  const appShellData = auth
    ? {
        me: {
          id: auth.user.id,
          name: auth.user.name,
          initials: initialsOf(auth.user.name),
          role: auth.workspace?.role ?? 'Member',
          settingsAccess: auth.workspace?.settingsAccess,
          authFree: auth.authFree,
        },
        notifications: shellNotifications,
        pinned: shellPinned,
        hiddenPages: shellHiddenPages,
        counts: shellCounts,
        workspace: auth.workspace
          ? { id: auth.workspace.id, name: auth.workspace.name }
          : null,
        workspaces: auth.workspaces
          .filter((workspace) => !workspace.suspended)
          .map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
          })),
      }
    : {
        me: { id: '', name: '', initials: '', role: '' },
        notifications: [],
        pinned: [],
        hiddenPages: [],
        counts: {},
        workspace: null,
        workspaces: [],
      }

  return (
    <ThemeProvider authenticated={Boolean(auth)}>
      <LiveEventProvider>
        <CollaborationEnabledContext.Provider
          value={auth?.collaborationEnabled ?? false}
        >
          <DemoSigningContext.Provider value={auth?.authFree ?? false}>
            {auth && !auth.authFree && !bareRoute ? (
              <SessionExpiredBanner />
            ) : null}
            {bareRoute ? (
              <Outlet />
            ) : auth && (!auth.workspace || auth.workspace.suspended) ? (
              // J-SET-03/04: no live membership. The shell and every
              // workspace read would fail without saying why.
              <AccessBlocked
                user={auth.user}
                suspendedWorkspace={
                  auth.workspace ? { name: auth.workspace.name } : null
                }
                contacts={auth.accessContacts ?? []}
                otherWorkspaces={auth.workspaces.filter(
                  (w) => w.id !== auth.workspace?.id && !w.suspended,
                )}
              />
            ) : legacyShell ? (
              <ShellProvider>
                <Outlet />
              </ShellProvider>
            ) : (
              <AvatarPhotosProvider>
                <V3AppShell
                  data={appShellData}
                  banner={auth && !auth.authFree ? <JoinOfferBanner /> : null}
                  workspaceMenuExtra={
                    auth && !auth.authFree ? <JoinOfferMenuItem /> : null
                  }
                >
                  <WorkspaceHost context={resolvedRootContext}>
                    <Outlet />
                  </WorkspaceHost>
                  {auth ? <StepTimersHost /> : null}
                </V3AppShell>
              </AvatarPhotosProvider>
            )}
          </DemoSigningContext.Provider>
        </CollaborationEnabledContext.Provider>
      </LiveEventProvider>
    </ThemeProvider>
  )
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

/**
 * Inline no-flash script: applies the saved theme to <html> before the React
 * tree hydrates, so there is no flash of the wrong theme on reload. Runs
 * synchronously in <head>. Production CSP allowlists inline scripts by
 * per-request nonce (see docs/operations/security-headers.md); the development
 * policy keeps 'unsafe-inline'.
 */
function RootDocument({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  return router.options.context.workspacePane ? (
    children
  ) : (
    <AppDocument>{children}</AppDocument>
  )
}

function AppDocument({ children }: { children: React.ReactNode }) {
  // R5-SHELL-02: the server read the `sb-theme` cookie, so the first paint
  // already carries the person's choice. `system` cannot be resolved on the
  // server (the device setting is not sent), so it is left unclassed here and
  // the inline script fills it in before paint.
  const { themePref, auth, queryClient } = Route.useRouteContext()

  return (
    <html
      lang="en"
      className={themePref === 'dark' ? 'dark' : undefined}
      data-theme-pref={themePref}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
        {/* The security middleware adds a per-request `nonce` to every inline
            script after React renders (src/start.ts), and browsers hide a
            nonce's value from the DOM once it is read. React would otherwise
            report the attribute as a hydration mismatch on every page load,
            burying real mismatches. */}
        <script
          dangerouslySetInnerHTML={{ __html: themeScript }}
          suppressHydrationWarning
        />
        <script
          dangerouslySetInnerHTML={{ __html: faviconScript }}
          suppressHydrationWarning
        />
      </head>
      <body>
        {children}
        {/* Every `toast()` in the app renders here: the call sites were
            mounted nowhere, so 140 confirmations and failures were invisible. */}
        <Toaster />
        <ChangeReasonDialog />
        <DevToolbar role={auth?.workspace?.role} queryClient={queryClient} />
        {import.meta.env.DEV && !import.meta.env.VITE_PARITY ? (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'TanStack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
