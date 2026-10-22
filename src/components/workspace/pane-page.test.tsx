import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterContextProvider,
  createMemoryHistory,
  createRouter,
  createRootRoute,
  Outlet,
  useBlocker,
  useRouter,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PanePage } from './pane-page'
import type { PanePageHandle } from './pane-page'
import type { RouterContext } from '#/routes/__root'
import { noCapabilities } from '#/lib/capabilities'
import { Route as LotRoute } from '#/routes/materials/$lotId'
import type * as ReagentData from '#/lib/reagent-data'

// Only server/data boundaries are replaced. Routes, route components, match
// context, memory history, root shellComponent and query hooks are real.
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      inputValidator: () => builder,
      validator: () => builder,
      handler: () => vi.fn(),
    }
    return builder
  },
  createServerOnlyFn: (fn: unknown) => fn,
}))
vi.mock('#/db/client.server', () => ({ db: {} }))
vi.mock('#/env.server', () => ({
  env: { DATABASE_URL: 'postgres://unused:unused@localhost/unused' },
}))
vi.mock('#/lib/auth', () => ({
  auth: {},
  getAppSession: vi.fn(),
  handleAuthRequest: vi.fn(),
}))
vi.mock('#/lib/identifier-resolution', () => ({
  resolveIdentifierParam: async () => {},
  redirectExperimentRecord: async () => {},
}))
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ names: {}, userLabel: () => 'Scientist' }),
}))
vi.mock('#/lib/reagent-data', async (original) => ({
  ...(await original<typeof ReagentData>()),
  fetchReagent: async (_client: unknown, id: string) => ({
    id,
    identifier: `MAT-${id}`,
    title: `Buffer ${id}`,
    status: 'available',
    metadataVersion: 1,
    quantity: 5,
    initialQuantity: 6,
    unit: 'mL',
    supplier: null,
    catalogNo: null,
    lot: id,
    expiry: null,
    storage: null,
    received: null,
    releasedBy: null,
    releasedAt: null,
    certificate: null,
  }),
  fetchReagentMovements: async () => [],
  fetchReagentUsage: async () => [],
}))

const LotPage = LotRoute.options.component!
afterEach(() => {
  cleanup()
  LotRoute.options.component = LotPage
  vi.restoreAllMocks()
})

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const context: RouterContext = {
    queryClient,
    auth: {
      user: { id: 'u', name: 'Scientist', email: 's@example.test' },
      workspace: { id: 'w', slug: 'lab', name: 'Lab', role: 'member' },
      workspaces: [],
      timeZone: 'Europe/London',
      collaborationEnabled: false,
    },
    capabilities: noCapabilities,
    shellCounts: {},
    shellPinned: [],
    shellNotifications: [],
    themePref: 'system',
  }
  const outer = createRouter({
    routeTree: createRootRoute({ component: Outlet }),
    history: createMemoryHistory(),
  })
  const handles = new Map<string, PanePageHandle>()
  const changed = vi.fn()
  function panes(href = '/materials/alpha', currentContext = context) {
    return (
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={outer}>
          <section aria-label="first">
            <PanePage
              id="first"
              href={href}
              active
              context={currentContext}
              onLocationChange={changed}
              onReady={(handle) => {
                if (handle) handles.set('first', handle)
              }}
            />
          </section>
          <section aria-label="second">
            <PanePage
              id="second"
              href="/materials/beta"
              active={false}
              context={currentContext}
              onLocationChange={() => {}}
              onReady={(handle) => {
                if (handle) handles.set('second', handle)
              }}
            />
          </section>
        </RouterContextProvider>
      </QueryClientProvider>
    )
  }
  return {
    ...render(panes()),
    handles,
    changed,
    queryClient,
    outer,
    panes,
    context,
  }
}

it('renders two real parameterised pages independently and keeps initial href stable', async () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const app = setup()
  const first = within(screen.getByRole('region', { name: 'first' }))
  const second = within(screen.getByRole('region', { name: 'second' }))
  expect(
    await first.findByRole('heading', { name: 'Buffer alpha' }),
  ).toBeTruthy()
  expect(
    await second.findByRole('heading', { name: 'Buffer beta' }),
  ).toBeTruthy()
  expect(document.querySelectorAll('html')).toHaveLength(1)
  expect(document.querySelectorAll('script')).toHaveLength(0)
  app.rerender(app.panes('/materials/ignored'))
  expect(first.getByRole('heading', { name: 'Buffer alpha' })).toBeTruthy()
  await act(async () => {
    await app.handles
      .get('first')!
      .navigate('/materials/gamma?source=split#ledger')
  })
  expect(
    await first.findByRole('heading', { name: 'Buffer gamma' }),
  ).toBeTruthy()
  expect(second.getByRole('heading', { name: 'Buffer beta' })).toBeTruthy()
  await waitFor(() =>
    expect(app.changed).toHaveBeenCalledWith(
      '/materials/gamma?source=split#ledger',
    ),
  )
  expect(scroll).not.toHaveBeenCalled()
  expect(
    app.queryClient.getQueryData(['ui-port', 'materials', 'lot', 'beta']),
  ).toBeTruthy()
  app.unmount()
  expect(
    app.queryClient.getQueryData(['ui-port', 'materials', 'lot', 'beta']),
  ).toBeTruthy()
})

it('refuses close and navigation while an existing spreadsheet unload guard is dirty', async () => {
  const app = setup()
  await screen.findByRole('heading', { name: 'Buffer alpha' })
  const guard = (event: Event) => event.preventDefault()
  window.addEventListener('beforeunload', guard)
  try {
    expect(await app.handles.get('first')!.requestClose()).toBe(false)
    await act(async () => {
      await app.handles.get('first')!.navigate('/materials/gamma')
    })
    expect(screen.getByRole('heading', { name: 'Buffer alpha' })).toBeTruthy()
  } finally {
    window.removeEventListener('beforeunload', guard)
  }
  expect(await app.handles.get('first')!.requestClose()).toBe(true)
})

it('sends authentication destinations to the outer router, not a pane document', async () => {
  const app = setup()
  await screen.findByRole('heading', { name: 'Buffer alpha' })
  await act(async () => {
    await app.handles.get('first')!.navigate('/sign-in?next=%2Fmaterials')
  })
  expect(app.outer.state.location.href).toBe('/sign-in?next=%2Fmaterials')
  expect(screen.getByRole('heading', { name: 'Buffer alpha' })).toBeTruthy()
})

it('refreshes inherited permission context without remounting or reporting unchanged locations', async () => {
  LotRoute.options.component = function RolePage() {
    const { context } = LotRoute.useRouteContext()
    return (
      <>
        <LotPage />
        <output aria-label="Role">{context.workspace?.role}</output>
      </>
    )
  }
  const app = setup()
  await screen.findByRole('heading', { name: 'Buffer alpha' })
  expect(
    screen
      .getAllByLabelText('Role')
      .every((element) => element.textContent === 'member'),
  ).toBe(true)
  const handle = app.handles.get('first')
  const auth = app.context.auth!
  const nextContext = {
    ...app.context,
    auth: { ...auth, workspace: { ...auth.workspace!, role: 'admin' } },
  }
  const notifications = app.changed.mock.calls.length
  app.rerender(app.panes(undefined, nextContext))
  await waitFor(() =>
    expect(
      screen
        .getAllByLabelText('Role')
        .every((element) => element.textContent === 'admin'),
    ).toBe(true),
  )
  expect(app.handles.get('first')).toBe(handle)
  expect(app.changed).toHaveBeenCalledTimes(notifications)
  app.rerender(app.panes(undefined, { ...nextContext }))
  expect(app.changed).toHaveBeenCalledTimes(notifications)
})

function ResolverPage() {
  const { lotId } = LotRoute.useParams()
  const blocker = useBlocker({
    shouldBlockFn: () => lotId === 'alpha',
    enableBeforeUnload: false,
    withResolver: true,
  })
  return (
    <>
      <LotPage />
      {blocker.status === 'blocked' && (
        <div role="dialog" aria-label="Unsaved notebook">
          <button onClick={blocker.reset}>Stay</button>
          <button onClick={blocker.proceed}>Leave</button>
        </div>
      )}
    </>
  )
}

it('protects Studio-style raw history pushes with unload guards and real resolver approval', async () => {
  LotRoute.options.component = function StudioPage() {
    const router = useRouter()
    return (
      <>
        <ResolverPage />
        <button
          onClick={() =>
            router.history.push('/materials/gamma?source=studio#result')
          }
        >
          Studio hand-off
        </button>
      </>
    )
  }
  const app = setup()
  await screen.findByRole('heading', { name: 'Buffer alpha' })
  const first = within(screen.getByRole('region', { name: 'first' }))
  const guard = (event: Event) => event.preventDefault()
  window.addEventListener('beforeunload', guard)
  try {
    fireEvent.click(first.getByRole('button', { name: 'Studio hand-off' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Buffer alpha' })).toBeTruthy()
  } finally {
    window.removeEventListener('beforeunload', guard)
  }
  fireEvent.click(first.getByRole('button', { name: 'Studio hand-off' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Stay' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('heading', { name: 'Buffer alpha' })).toBeTruthy()
  fireEvent.click(first.getByRole('button', { name: 'Studio hand-off' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Leave' }))
  expect(
    await screen.findByRole('heading', { name: 'Buffer gamma' }),
  ).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Buffer beta' })).toBeTruthy()
  await waitFor(() =>
    expect(app.changed).toHaveBeenCalledWith(
      '/materials/gamma?source=studio#result',
    ),
  )
})

it('runs real resolver blockers for close and settles refused navigation without changing the page', async () => {
  LotRoute.options.component = ResolverPage
  const app = setup()
  await screen.findByRole('heading', { name: 'Buffer alpha' })
  let closing: Promise<boolean>
  act(() => {
    closing = app.handles.get('first')!.requestClose()
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Stay' }))
  await act(async () => {
    expect(await closing).toBe(false)
  })
  let navigating: Promise<void>
  act(() => {
    navigating = app.handles.get('first')!.navigate('/materials/gamma')
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Stay' }))
  await act(async () => {
    await navigating
  })
  expect(screen.getByRole('heading', { name: 'Buffer alpha' })).toBeTruthy()
  act(() => {
    closing = app.handles.get('first')!.requestClose()
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Leave' }))
  await act(async () => {
    expect(await closing).toBe(true)
  })
  expect(screen.getByRole('heading', { name: 'Buffer alpha' })).toBeTruthy()
  act(() => {
    navigating = app.handles.get('first')!.navigate('/materials/gamma')
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Leave' }))
  await act(async () => {
    await navigating
  })
  expect(
    await screen.findByRole('heading', { name: 'Buffer gamma' }),
  ).toBeTruthy()
})

it('settles an in-flight close on unmount and stops location callbacks', async () => {
  LotRoute.options.component = ResolverPage
  const app = setup()
  await screen.findByRole('heading', { name: 'Buffer alpha' })
  let closing: Promise<boolean>
  act(() => {
    closing = app.handles.get('first')!.requestClose()
  })
  await screen.findByRole('dialog', { name: 'Unsaved notebook' })
  app.unmount()
  expect(await closing!).toBe(false)
  const count = app.changed.mock.calls.length
  await new Promise((resolve) => setTimeout(resolve, 10))
  expect(app.changed).toHaveBeenCalledTimes(count)
})

it('settles a superseded navigation and a navigation cancelled by unmount', async () => {
  LotRoute.options.component = ResolverPage
  const app = setup()
  await screen.findByRole('heading', { name: 'Buffer alpha' })
  let first: Promise<void>
  act(() => {
    first = app.handles.get('first')!.navigate('/materials/gamma')
  })
  await screen.findByRole('dialog', { name: 'Unsaved notebook' })
  let second: Promise<void>
  act(() => {
    second = app.handles.get('first')!.navigate('/materials/delta')
  })
  await act(async () => {
    await first
  })
  expect(screen.getByRole('heading', { name: 'Buffer alpha' })).toBeTruthy()
  app.unmount()
  await second!
})
