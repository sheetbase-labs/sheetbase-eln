import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import { LiveEventProvider } from '../components/live'
import { ShellProvider } from '../components/app-shell'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import { CollaborationProvider } from '../components/collaboration/collaboration-provider'
import { CollaborationEnabledContext } from '#/lib/collaboration/liveblocks.config'
import { createServerFn } from '@tanstack/react-start'

import appCss from '../styles.css?url'

import { ThemeProvider } from '../components/theme-provider'

import type { QueryClient } from '@tanstack/react-query'
import type { CurrentContext } from '#/lib/current-user'

interface RouterContext {
  queryClient: QueryClient
  auth: CurrentContext | null
}

// Fetch auth context once at the root so every child route can read it
// from the router context without each making its own server round-trip.
// The dynamic imports inside the handler are server-only — TanStack
// Start's import protection allows them because the handler never runs
// in the client bundle.
const getAuthContextFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequestHeaders } = await import('@tanstack/react-start/server')
  const { getCurrentContext } = await import('#/lib/current-user')
  return getCurrentContext(getRequestHeaders())
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
  // Unmatched URLs render inside the root (and therefore inside the app
  // shell) with a way back — the framework default is bare "Not Found" text.
  notFoundComponent: NotFoundPage,
  beforeLoad: async () => {
    const auth = await getAuthContextFn()
    return { auth }
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
  const { auth } = Route.useRouteContext()

  // Map the auth context to the AppShell context shape so the sidebar
  // (workspace name, user info, nav) renders during SSR — not after
  // hydration.  This eliminates the multi-second delay where main
  // content appeared but the sidebar was missing.
  const shellContext = auth
    ? {
        workspace: auth.workspace ? { name: auth.workspace.name } : null,
        user: {
          name: auth.user.name,
          email: auth.user.email,
          role: auth.workspace?.role,
        },
      }
    : null

  return (
    <LiveEventProvider>
      <CollaborationEnabledContext.Provider
        value={auth?.collaborationEnabled ?? false}
      >
        <CollaborationProvider>
          <ShellProvider initialContext={shellContext}>
            <Outlet />
          </ShellProvider>
        </CollaborationProvider>
      </CollaborationEnabledContext.Provider>
    </LiveEventProvider>
  )
}

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page you’re looking for doesn’t exist or may have moved.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block text-sm text-primary hover:underline"
      >
        ← Back to home
      </Link>
    </div>
  )
}

/**
 * Inline no-flash script: applies the saved theme to <html>
 * before the React tree hydrates, so there is no flash of the wrong theme
 * on reload. Runs synchronously in <head>. Production CSP allowlists inline
 * scripts by per-request nonce (see docs/operations/security-headers.md):
 * the nonce is stamped into the SSR HTML by injectNonceIntoHtml after
 * render, so the client vnode never carries it. suppressHydrationWarning
 * keeps React from flagging that server-only attribute as a mismatch.
 */
const themeNoFlash = `(function(){try{var t=localStorage.getItem('sheetbase-theme')||'light';var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)document.documentElement.classList.add('dark');}catch(e){}})();`

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{ __html: themeNoFlash }}
          suppressHydrationWarning
        />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        {import.meta.env.DEV ? (
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
