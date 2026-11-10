import { Suspense, startTransition, use, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
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
import { PanePage } from '#/components/workspace/pane-page'
import type { PanePageHandle } from '#/components/workspace/pane-page'
import { usePaneContext } from '#/components/workspace/workspace-navigation'
import { ThemeProvider } from '#/components/theme-provider'
import { Toaster } from '#/components/ui/sonner'
import type { RouterContext } from '#/routes/__root'
import { Route as LotRoute } from '#/routes/materials/$lotId'
import { noCapabilities } from '#/lib/capabilities'
import { registerPendingEditForTest } from '#/lib/pending-edits'
import '#/styles.css'

interface CallbackEvent {
  generation: string
  pane: string
  kind:
    'location' | 'ready' | 'newer' | 'select' | 'frozen' | 'missing' | 'primary'
  value: string | boolean | null
}

export interface PanePageFixture {
  snapshot: () => {
    events: CallbackEvent[]
    outcomes: Record<string, boolean | 'done'>
    saved: number
    discarded: number
    scrolls: number
    suspensions: number
    sameHandles: boolean
    betaCached: boolean
    outerHref: string
  }
  navigate: (href: string) => Promise<void>
  startNavigate: (key: string, href: string) => void
  startClose: (key: string, pane?: string) => void
  guard: (dirty: boolean) => void
  pendingEdit: (enabled: boolean) => void
  rerender: (options: Partial<FixtureState>, transition?: boolean) => void
  unmount: () => void
}

declare global {
  interface Window {
    panePageFixture: PanePageFixture
  }
}

interface FixtureState {
  generation: string
  href: string
  role: string
  readOnly: boolean
  editingPane?: { identifier?: string; sameRecord: boolean }
  followedSelection?: string
  pending: boolean
}

const events: CallbackEvent[] = []
const outcomes: Record<string, boolean | 'done'> = {}
const handles = new Map<string, PanePageHandle>()
const originalHandles = new Map<string, PanePageHandle>()
let saved = 0
let discarded = 0
let scrolls = 0
let removeEdit: (() => void) | undefined
const guard = (event: Event) => event.preventDefault()
const params = new URLSearchParams(location.search)
const resolverEnabled = params.get('blockers') === 'true'
const pending = new Promise<void>(() => {})

const LotPage = LotRoute.options.component

if (!LotPage) throw new Error('Material route component required')

function TestLotPage() {
  const { lotId } = LotRoute.useParams()
  const { context } = LotRoute.useRouteContext()
  const router = useRouter()
  const pane = usePaneContext()

  const blocker = useBlocker({
    shouldBlockFn: () => resolverEnabled && lotId === 'alpha',
    enableBeforeUnload: false,
    withResolver: true,
  })

  return (
    <>
      <LotPage />
      <output aria-label="Role">{context.workspace?.role}</output>
      <output aria-label="Pane access">
        {pane.readOnly ? 'read-only' : 'editable'}
      </output>
      <output aria-label="Editing pane">
        {pane.editingPane?.identifier}:{String(pane.editingPane?.sameRecord)}
      </output>
      <output aria-label="Followed selection">{pane.followedSelection}</output>
      <button disabled={pane.readOnly}>Fixture edit action</button>
      <button
        onClick={() => {
          pane.reportNewer('revision-2')
          pane.reportSelection('row-b')
          pane.reportFrozen('approved')
          pane.reportMissing?.(true)
          pane.makePrimary?.()
        }}
      >
        Publish pane reports
      </button>
      <button
        onClick={() =>
          router.history.push('/materials/gamma?source=studio#result')
        }
      >
        Studio hand-off
      </button>
      <button
        onClick={() =>
          router.navigate({
            to: '/materials/$lotId',
            params: { lotId: 'gamma' },
            hash: 'details',
          })
        }
      >
        Navigate with typed options
      </button>
      {blocker.status === 'blocked' && (
        <div role="dialog" aria-label="Unsaved notebook">
          <button onClick={blocker.reset}>Stay</button>
          <button onClick={blocker.proceed}>Leave</button>
        </div>
      )}
    </>
  )
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

const workspace = { id: 'w', slug: 'lab', name: 'Lab', role: 'member' }

const auth = {
  user: { id: 'u', name: 'Scientist', email: 's@example.test' },
  workspace,
  workspaces: [],
  timeZone: 'Europe/London',
  collaborationEnabled: false,
}

const context: RouterContext = {
  queryClient,
  auth,
  capabilities: noCapabilities,
  shellCounts: {},
  shellPinned: [],
  shellHiddenPages: [],
  shellNotifications: [],
  themePref: 'system',
  labLogo: null,
}

const outer = createRouter({
  routeTree: createRootRoute({ component: Outlet }),
  history: createMemoryHistory(),
})

function SuspendRender({ active }: { active: boolean }) {
  if (active) use(pending)

  return null
}

const target = document.getElementById('root')

if (!target) throw new Error('Pane fixture root required')

function Fixture({ unmount }: { unmount: () => void }) {
  const [state, setState] = useState<FixtureState>({
    generation: 'old',
    href: '/materials/alpha',
    role: 'member',
    readOnly: false,
    pending: false,
  })

  useEffect(() => {
    window.panePageFixture = {
      snapshot: () => ({
        events: [...events],
        outcomes: { ...outcomes },
        saved,
        discarded,
        scrolls,
        suspensions:
          'status' in pending && pending.status === 'pending' ? 1 : 0,
        sameHandles: [...handles].every(
          ([id, handle]) => originalHandles.get(id) === handle,
        ),
        betaCached: Boolean(
          queryClient.getQueryData(['ui-port', 'materials', 'lot', 'beta']),
        ),
        outerHref: outer.state.location.href,
      }),
      navigate: async (href) => {
        await handles.get('first')?.navigate(href)
      },
      startNavigate: (key, href) => {
        void handles
          .get('first')
          ?.navigate(href)
          .then(() => {
            outcomes[key] = 'done'
          })
      },
      startClose: (key, pane = 'first') => {
        void handles
          .get(pane)
          ?.requestClose()
          .then((result) => {
            outcomes[key] = result
          })
      },
      guard: (dirty) => {
        window.removeEventListener('beforeunload', guard)

        if (dirty) window.addEventListener('beforeunload', guard)
      },
      pendingEdit: (enabled) => {
        removeEdit?.()
        removeEdit = enabled
          ? registerPendingEditForTest({
              label: 'Analysis Studio',
              paneId: 'first',
              save: async () => {
                saved++

                return true
              },
              discard: () => {
                discarded++
              },
            })
          : undefined
      },
      rerender: (options, transition = false) => {
        const update = () => setState((current) => ({ ...current, ...options }))

        if (transition) startTransition(update)
        else update()
      },
      unmount: () => {
        unmount()
        removeEdit?.()
        window.removeEventListener('beforeunload', guard)
      },
    }
  }, [unmount])

  const currentContext = {
    ...context,
    auth: { ...auth, workspace: { ...workspace, role: state.role } },
  }

  const pane = (id: string, href: string) => {
    const record = (
      kind: CallbackEvent['kind'],
      value: CallbackEvent['value'] = null,
    ) => {
      events.push({ generation: state.generation, pane: id, kind, value })
    }

    return (
      <section aria-label={id}>
        <PanePage
          id={id}
          href={href}
          active={id === 'first'}
          context={currentContext}
          readOnly={state.readOnly}
          editingPane={state.editingPane}
          followedSelection={state.followedSelection}
          onLocationChange={(value) => record('location', value)}
          onNewer={(value) => record('newer', value ?? null)}
          onSelect={(value) => record('select', value ?? null)}
          onFrozen={(value) => record('frozen', value)}
          onMissing={(value) => record('missing', value)}
          onMakePrimary={() => record('primary')}
          onReady={(handle) => {
            record('ready', handle !== null)

            if (handle) {
              handles.set(id, handle)

              if (!originalHandles.has(id)) originalHandles.set(id, handle)
            }
          }}
        />
      </section>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterContextProvider router={outer}>
          <Suspense fallback={<p>Pending pane tree</p>}>
            <output aria-label="Callback generation">{state.generation}</output>
            {pane('first', state.href)}
            {pane('second', '/materials/beta')}
            <SuspendRender active={state.pending} />
          </Suspense>
        </RouterContextProvider>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  )
}

// Vite's Fast Refresh self-import can evaluate both bare and timestamped entries.
// Bootstrap each fixture document once, including its real route wrapper.
if (!target.hasAttribute('data-pane-page-fixture')) {
  target.setAttribute('data-pane-page-fixture', '')
  LotRoute.options.component = TestLotPage
  window.addEventListener('scroll', () => {
    scrolls++
  })

  // Observe native scroll requests without replacing their implementation.
  const scrollTo = window.scrollTo.bind(window)

  window.scrollTo = (...args: Parameters<typeof window.scrollTo>) => {
    scrolls++
    scrollTo(...args)
  }

  const root = createRoot(target)

  root.render(<Fixture unmount={() => root.unmount()} />)
}
