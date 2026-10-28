import { setDisplayTimeZone } from '#/lib/display-time-zone'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useMatches,
  useRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { LiveEventProvider } from '../components/live'
import { ShellProvider } from '../components/shell'
import { AppShell as V3AppShell } from '#/components/v3/shell/app-shell'
import { WorkspaceHost } from '#/components/workspace/workspace-host'
import { SessionExpiredBanner } from '#/components/v3/shell/session-expired-banner'
import { AccessBlocked } from '#/components/v3/shell/access-blocked'
import { Toaster } from '#/components/v3/ui/sonner'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import { CollaborationProvider } from '../components/collaboration/collaboration-provider'
import { CollaborationEnabledContext } from '#/lib/collaboration/collaboration-enabled'
import { createServerFn } from '@tanstack/react-start'

import appCss from '../styles.css?url'

import { ThemeProvider } from '../components/theme-provider'

import type { QueryClient } from '@tanstack/react-query'
import type { CurrentContext } from '#/lib/current-user'
import type { ShellCounts } from '#/lib/shell-counts.server'
import type { ShellPinned } from '#/lib/shell-chrome.server'
import type { Notification } from '#/components/v3/types'
import { parseThemeCookie, themeScript } from '#/lib/theme-cookie'
import type { ThemePref } from '#/lib/theme-cookie'
import { capabilitiesFromEnv } from '#/lib/capabilities'
import type { Capabilities } from '#/lib/capabilities'

export interface RouterContext {
  workspacePane?: boolean
  queryClient: QueryClient
  auth: CurrentContext | null
  shellCounts: ShellCounts
  shellPinned: ShellPinned[]
  shellNotifications: Notification[]
  themePref: ThemePref
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
  if (!context?.workspace)
    return {
      context,
      capabilities,
      counts: {},
      pinned: [],
      notifications: [],
      themePref,
    }
  const { getShellCounts } = await import('#/lib/shell-counts.server')
  const { getShellPinned, getShellNotifications } =
    await import('#/lib/shell-chrome.server')
  const [counts, pinned, notifications] = await Promise.all([
    getShellCounts(context.workspace.id, context.user.id),
    getShellPinned(context.workspace.id, context.user.id),
    getShellNotifications(context.workspace.id, context.user.id),
  ])
  return { context, capabilities, counts, pinned, notifications, themePref }
})

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Sheetbase',
      },
      {
        name: 'description',
        content: 'A precise, flexible electronic laboratory notebook.',
      },
    ],
    links: [
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
  beforeLoad: async ({ context }) => {
    if (context.workspacePane) return context
    const {
      context: auth,
      capabilities,
      counts: shellCounts,
      pinned,
      notifications,
      themePref,
    } = await getAuthContextFn()
    setDisplayTimeZone(auth?.timeZone)
    return {
      auth,
      capabilities,
      shellCounts,
      shellPinned: pinned,
      shellNotifications: notifications,
      themePref,
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
  const { auth, shellCounts, shellPinned, shellNotifications } =
    resolvedRootContext
  // Hydration restores the dehydrated route context without re-running
  // `beforeLoad`, so the first browser render sets the display zone here. It
  // is a no-op when `beforeLoad` already did.
  setDisplayTimeZone(auth?.timeZone)

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
    // The development-only A/B component comparison harness (ADR-0055). Same
    // terms: production redirects to `/`, and it carries no business data.
    '/component-compare',
  ]
  // Routes with their own chrome (the client portal, ADR-0049) render without
  // either shell: no internal navigation and no workspace data.
  const bareRouteIds = [
    '/client-portal',
    '/sign-in',
    '/sign-in_/two-factor',
    '/accept-invitation',
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
        },
        notifications: shellNotifications,
        pinned: shellPinned,
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
          <CollaborationProvider>
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
              <V3AppShell data={appShellData}>
                <WorkspaceHost context={resolvedRootContext}>
                  <Outlet />
                </WorkspaceHost>
              </V3AppShell>
            )}
          </CollaborationProvider>
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
  const { themePref } = Route.useRouteContext()
  return (
    <html
      lang="en"
      className={themePref === 'dark' ? 'dark' : undefined}
      data-theme-pref={themePref}
      suppressHydrationWarning
    >
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        {/* Every `toast()` in the app renders here: the call sites were
            mounted nowhere, so 140 confirmations and failures were invisible. */}
        <Toaster />
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
