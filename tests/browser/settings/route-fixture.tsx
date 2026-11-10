import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { z } from 'zod'

import { ThemeProvider } from '#/components/theme-provider'
import { Toaster } from '#/components/ui/sonner'
import type { CurrentContext } from '#/lib/current-user'
import { resolveSettingsAccess } from '#/lib/settings-access'
import { Route as Usage } from '#/routes/settings/workspace/usage'
import { Route as Backups } from '#/routes/settings/workspace/backups'
import { Route as Diagnostics } from '#/routes/settings/workspace/diagnostics'
import { Route as Api } from '#/routes/settings/account/api'
import { Route as Profile } from '#/routes/settings/account/profile'
import { Route as Signature } from '#/routes/settings/account/signature'
import '#/styles.css'

// This page tests compiled clients and actual components, not the app's
// server bootstrap or authorization. Playwright owns every network fixture.
const params = new URLSearchParams(location.search)

const role = z
  .enum(['owner', 'admin', 'viewer'])
  .parse(params.get('role') ?? 'owner')

const settingsAccess = resolveSettingsAccess(role)

if (params.get('backups') === 'view') settingsAccess.backups = 'view'

const context: CurrentContext = {
  user:
    params.get('view') === 'signature'
      ? { id: 'me', name: 'Ada Lovelace', email: 'ada@sheetbase.test' }
      : { id: 'gareth', name: 'Gareth P.', email: 'owner@sheetbase.test' },
  workspace: {
    id: 'ws',
    slug: 'workspace',
    name: 'Workspace',
    role,
    username: 'gareth',
    settingsAccess,
  },
  workspaces: [],
  timeZone: 'Europe/London',
  collaborationEnabled: false,
  dataAccess: false,
}

const routes = {
  usage: { route: Usage, path: '/settings/workspace/usage' },
  backups: { route: Backups, path: '/settings/workspace/backups' },
  diagnostics: { route: Diagnostics, path: '/settings/workspace/diagnostics' },
  api: { route: Api, path: '/settings/account/api' },
  profile: { route: Profile, path: '/settings/account/profile' },
  signature: { route: Signature, path: '/settings/account/signature' },
}

const name = z
  .enum(['usage', 'backups', 'diagnostics', 'api', 'profile', 'signature'])
  .parse(params.get('view'))

const fixture = routes[name]
const Component = fixture.route.options.component

if (!Component) throw new Error('Route component required')

let contextReads = 0

const root = createRootRoute({
  beforeLoad: () => {
    document.documentElement.dataset.contextReads = String(++contextReads)

    return { context, auth: context }
  },
})

// The application route declares this loader without context arguments. Parse
// that callable contract before attaching it beneath the fixture root.
const signatureLoader = z
  .function({
    input: [],
    output: z.promise(z.object({ signInAvailable: z.boolean() })),
  })
  .parse(Signature.options.loader)

const route = createRoute({
  getParentRoute: () => root,
  path: fixture.path,
  component: Component,
  loader: name === 'signature' ? () => signatureLoader() : undefined,
  validateSearch:
    name === 'signature' ? Signature.options.validateSearch : undefined,
})

const router = createRouter({
  routeTree: root.addChildren([route]),
  history: createMemoryHistory({
    initialEntries: [
      fixture.path +
        (params.has('returnTo')
          ? `?returnTo=${encodeURIComponent(params.get('returnTo') ?? '')}`
          : ''),
    ],
  }),
})

const target = document.getElementById('root')

if (!target) throw new Error('Fixture root required')

createRoot(target).render(
  <QueryClientProvider
    client={
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
    }
  >
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster />
    </ThemeProvider>
  </QueryClientProvider>,
)
