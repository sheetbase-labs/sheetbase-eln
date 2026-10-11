import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useMatches,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { LiveEventProvider } from '../components/live'
import { ShellProvider } from '../components/shell'
import { AppShell as V3AppShell } from '#/components/v3/shell/app-shell'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import { CollaborationProvider } from '../components/collaboration/collaboration-provider'
import { CollaborationEnabledContext } from '#/lib/collaboration/liveblocks.config'
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

interface RouterContext {
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
  beforeLoad: async () => {
    const {
      context: auth,
      capabilities,
      counts: shellCounts,
      pinned,
      notifications,
      themePref,
    } = await getAuthContextFn()
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
  const { auth, shellCounts, shellPinned, shellNotifications } =
    Route.useRouteContext()

  // Map the auth context to the AppShell context shape so the sidebar
  // (workspace name, user info, nav) renders during SSR — not after
  // hydration.  This eliminates the multi-second delay where main
  // content appeared but the sidebar was missing.
  const shellContext = auth
    ? {
        workspace: auth.workspace
          ? {
              id: auth.workspace.id,
              slug: auth.workspace.slug,
              name: auth.workspace.name,
            }
          : null,
        workspaces: auth.workspaces,
        user: {
          name: auth.user.name,
          email: auth.user.email,
          role: auth.workspace?.role,
        },
      }
    : null

  // UI port (roadmap-4/ui-app3): routes already ported from sheetbase-app-3
  // render inside app-3's shell; every other route keeps the ELN shell until it
  // is ported. The list grows area by area, then this branch and the ELN shell
  // are deleted.
  const v3RouteIds = [
    '/',
    // R5-SURF-03: the unmatched-URL catch-all renders the product's not-found
    // screen inside the v3 shell.
    '/$',
    '/inbox',
    '/review/$revisionId',
    '/evidence/$revisionId',
    '/instruments',
    '/instruments/$instrumentId',
    '/scan',
    '/readings/new',
    '/sheets/$sheetId',
    '/sheets/new',
    '/records/$recordId',
    '/records/$recordId/',
    '/records/$recordId/notebook',
    '/schedule',
    '/search',
    '/settings',
    '/settings/',
    '/settings/members',
    '/settings/access',
    '/settings/signatures',
    '/settings/instruments',
    '/settings/integrations',
    '/settings/integrations/$connectorId',
    '/settings/audit',
    '/settings/diagnostics',
    '/settings/usage',
    '/settings/api',
    '/settings/profile',
    '/settings/notifications',
    '/protocols',
    '/protocols/$protocolId',
    '/templates',
    '/templates/$templateId',
    '/templates/$templateId/',
    '/templates/$templateId/versions',
    '/templates/$templateId/in-use',
    '/templates/$templateId/update',
    '/experiments',
    '/experiments/new',
    '/experiments/$expId',
    '/experiments/$expId/',
    '/experiments/$expId/overview',
    '/experiments/$expId/notebook',
    '/experiments/$expId/samples',
    '/experiments/$expId/datasets',
    '/experiments/$expId/results',
    '/experiments/$expId/files',
    '/experiments/$expId/history',
    '/models',
    '/models/$modelId',
    '/models/$modelId/',
    '/models/$modelId/fields',
    '/models/$modelId/versions',
    '/models/$modelId/records',
    '/models/$modelId/records/',
    '/models/$modelId/records/new',
    '/models/$modelId/records/$recordId',
    '/models/$modelId/rules',
    '/models/$modelId/relations',
    '/models/$modelId/usage',
    '/models/$modelId/datasets',
    '/models/$modelId/edit',
    '/analysis',
    '/analysis/',
    '/analysis/new',
    '/analysis/$analysisId',
    '/help',
    '/help/',
    '/help/records',
    '/help/shortcuts',
    '/pipelines',
    '/pipelines/agents',
    '/pipelines/runs/$runId',
    '/pipelines/$pipelineId',
    '/pipelines/$pipelineId/',
    '/pipelines/$pipelineId/runs',
    '/pipelines/$pipelineId/runs/',
    '/pipelines/$pipelineId/runs/$runId',
    '/pipelines/$pipelineId/triggers',
    '/pipelines/$pipelineId/steps',
    '/import',
    '/import/$importId',
    '/datasets',
    '/datasets/$datasetId',
    '/datasets/$datasetId/',
    '/datasets/$datasetId/snapshots',
    '/datasets/$datasetId/rows',
    '/datasets/$datasetId/compare',
    '/samples',
    '/materials',
    '/samples/$sampleId',
    '/samples/$sampleId/',
    '/samples/$sampleId/usage',
    '/samples/$sampleId/history',
    '/samples/$sampleId/lineage',
    '/samples/$sampleId/measurements',
    '/projects',
    '/projects/$projectId',
    '/projects/$projectId/',
    '/projects/$projectId/milestones',
    '/projects/$projectId/folders',
    '/projects/$projectId/members',
    '/projects/$projectId/settings',
  ]
  // Routes with their own chrome (the client portal, ADR-0049) render without
  // either shell: no internal navigation and no workspace data.
  const bareRouteIds = ['/client-portal', '/sign-in']
  const bareRoute = useMatches().some((match) =>
    bareRouteIds.includes(match.routeId),
  )
  const portedToV3 = useMatches().some((match) =>
    v3RouteIds.includes(match.routeId),
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
        workspaces: auth.workspaces.map((workspace) => ({
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
            {bareRoute ? (
              <Outlet />
            ) : portedToV3 ? (
              <V3AppShell data={appShellData}>
                <Outlet />
              </V3AppShell>
            ) : (
              <ShellProvider initialContext={shellContext}>
                <Outlet />
              </ShellProvider>
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
