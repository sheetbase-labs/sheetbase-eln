/**
 * Materials registry — the inspector offers one replacement-lot action, the
 * toolbar's Sort menu reorders the lots the route fetched, and both write
 * dialogs state why they refuse a submission instead of returning silently.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createReagent,
  recordReagentMovement,
  registerReplacementLot,
} from '#/lib/reagent-data'
import type * as ReagentData from '#/lib/reagent-data'
import type { Reagent } from '#/lib/reagent-data'
import { MaterialsRoute } from './-materials-page'
import type { MaterialTab } from './-materials-page'

/** The materials route's search, as its `validateSearch` shapes it. */
interface MaterialsSearch {
  q?: string
  tab?: MaterialTab
  selected?: string
  new?: true
}

/** What the screen hands `navigate`: a path plus its search up-date. */
interface NavigateCall {
  search?: MaterialsSearch | ((current: MaterialsSearch) => MaterialsSearch)
}

/** A navigate call whose search is the up-date function the tab move builds. */
interface NavigateFunctionCall {
  search: (current: MaterialsSearch) => MaterialsSearch
}

/** The stub's search value; each case rewrites it before rendering. */
interface SearchState {
  value: MaterialsSearch
}

const fixtures = vi.hoisted(() => {
  const reagents: Reagent[] = []

  return { reagents }
})

const search = vi.hoisted(() => {
  const state: SearchState = { value: {} }

  return state
})

const navigate = vi.hoisted(() => ({
  fn: (_options: NavigateCall) => {},
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Capability checks read the signed-in person's workspace; this suite renders the write affordances, so the boundary answers yes.
vi.mock('#/lib/use-capability', () => ({ useHasCapability: () => true }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The router's factories are bound to the generated route tree at import time; this suite renders the materials screen's own behaviour with the search and navigation the shell would supply.
vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => search.value,
    useNavigate: () => (options: NavigateCall) => navigate.fn(options),
  }),
  redirect: <T,>(options: T): T => options,
  useRouterState: <T,>({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => T
  }) => select({ location: { pathname: '/materials' } }),
  Outlet: () => null,
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string
    children?: React.ReactNode
  } & Omit<React.ComponentProps<'a'>, 'href'>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The screen toasts through the shared sonner portal, which mounts no portal in jsdom; this suite never inspects the toast.
vi.mock('#/components/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The project list needs a database; the double answers the one project the dialog's select renders.
vi.mock('#/lib/notebook-data', () => ({
  notebookDataClient: {
    list: async () => [{ id: 'p-1', title: 'Project A', project_id: 'p-1' }],
  },
}))

// The registry read and every write go through the domain library; mock only
// those, so the tests observe what the screen asks the boundary to do.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Every read and write in this suite goes through this module; the double keeps its real mappers and scripted answers so the assertions see the arguments the screen passes the boundary.
vi.mock('#/lib/reagent-data', async (importOriginal) => {
  const actual = await importOriginal<typeof ReagentData>()

  return {
    ...actual,
    fetchReagentsPage: vi.fn(async () => fixtures.reagents),
    fetchReagentsCount: vi.fn(async () => fixtures.reagents.length),
    recordReagentMovement: vi.fn(async () => undefined),
    registerReplacementLot: vi.fn(async () => undefined),
    createReagent: vi.fn(),
    fetchReagentUsage: vi.fn(async () => []),
    fetchReplacementLot: vi.fn(async () => null),
    fetchCertificateFile: vi.fn(async () => null),
  }
})

/**
 * jsdom has no layout: the grid's virtualiser measures a zero-height viewport
 * and would render no rows at all, so the order this test is about could not be
 * observed. The double returns the full row range — the same rows the browser
 * renders — and only the five methods the grid calls; the real virtualiser is
 * covered by `tests/browser/registry-grid.test.ts`, which asserts its own
 * `data-index` attribute. Same double as `protocols.test.tsx`.
 */
// oxlint-disable-next-line anti-slop/no-module-mocking -- jsdom has no layout, so the real virtualiser measures a zero-height viewport and renders no rows; the double returns the full range the browser renders, and its own behaviour is covered by tests/browser/registry-grid.test.ts.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 33,
        end: index * 33 + 33,
        size: 33,
      })),
    getTotalSize: () => count * 33,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}))

function makeReagent(overrides: Partial<Reagent> = {}): Reagent {
  return {
    id: 'mat-1',
    identifier: 'MAT-0001',
    title: 'Filter train B',
    status: 'available',
    tags: [],
    projectId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    metadataVersion: 1,
    category: '',
    supplier: 'Sigma',
    catalogNo: null,
    lot: 'L1',
    expiry: '2027-05-01',
    quantity: 5,
    initialQuantity: 6,
    unit: 'mL',
    storage: 'Shelf 2',
    received: '2026-01-01',
    releasedBy: null,
    releasedAt: null,
    certificate: null,
    lowStockThreshold: null,
    expiryWarningDays: null,
    record: {
      id: 'mat-1',
      projectId: null,
      kind: 'material',
      identifier: 'MAT-0001',
      title: 'Filter train B',
      status: 'available',
      tags: [],
      structureVersion: 1,
      metadataVersion: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      archivedAt: null,
      deletedAt: null,
      createdByUserId: 'u1',
      updatedByUserId: null,
      properties: {},
      lockedAt: null,
      lockedByRevisionId: null,
    },
    ...overrides,
  }
}

function renderRoute() {
  const Component = MaterialsRoute

  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

beforeEach(() => {
  vi.resetAllMocks()
  search.value = {}
  fixtures.reagents = [makeReagent()]
})

describe('materials inspector', () => {
  it('offers one replacement-lot action', async () => {
    renderRoute()

    expect(await screen.findAllByText('MAT-0001')).not.toHaveLength(0)
    expect(
      screen.getAllByRole('button', { name: 'Register replacement lot' }),
    ).toHaveLength(1)
  })

  it('heads its inspector sections at H2, with no skipped level', async () => {
    renderRoute()

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Lot' }),
    ).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
  })
})

describe('materials toolbar', () => {
  it('reorders the lots the route fetched when a column header is clicked', async () => {
    const user = userEvent.setup()
    fixtures.reagents = [
      makeReagent({
        id: 'mat-1',
        identifier: 'MAT-0001',
        expiry: '2027-05-01',
      }),
      makeReagent({
        id: 'mat-2',
        identifier: 'MAT-0002',
        expiry: '2027-01-15',
      }),
    ]
    renderRoute()

    expect(await screen.findAllByText('MAT-0002')).not.toHaveLength(0)
    const table = screen.getByRole('table', { name: 'Material lots' })

    const ids = () =>
      within(table)
        .getAllByText(/^MAT-\d+$/)
        .map((cell) => cell.textContent)

    // Default ordering is soonest expiry first, not the order the page arrived in.
    expect(ids()).toEqual(['MAT-0002', 'MAT-0001'])

    await user.click(within(table).getByRole('button', { name: 'ID' }))

    await waitFor(() => expect(ids()).toEqual(['MAT-0001', 'MAT-0002']))
  })
})

describe('receive lot dialog', () => {
  it('explains a refused receive with no quantity', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findAllByText('MAT-0001')
    await user.click(screen.getByRole('button', { name: 'Receive lot' }))
    await user.click(screen.getByRole('button', { name: 'Receive' }))

    expect(recordReagentMovement).not.toHaveBeenCalled()
    expect(
      screen.getByText('Enter the quantity received, greater than zero.'),
    ).toBeTruthy()
    expect(screen.getByLabelText(/Quantity/).getAttribute('aria-invalid')).toBe(
      'true',
    )
  })

  it('explains a refused receive of zero', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findAllByText('MAT-0001')
    await user.click(screen.getByRole('button', { name: 'Receive lot' }))
    await user.type(screen.getByLabelText(/Quantity/), '0')
    await user.click(screen.getByRole('button', { name: 'Receive' }))

    expect(recordReagentMovement).not.toHaveBeenCalled()
    expect(
      screen.getByText('Enter the quantity received, greater than zero.'),
    ).toBeTruthy()
  })

  it('receives a positive quantity', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findAllByText('MAT-0001')
    await user.click(screen.getByRole('button', { name: 'Receive lot' }))
    await user.type(screen.getByLabelText(/Quantity/), '3')
    await user.click(screen.getByRole('button', { name: 'Receive' }))

    await waitFor(() =>
      expect(recordReagentMovement).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ operation: 'receive', quantityDelta: 3 }),
      ),
    )
  })
})

describe('replacement lot dialog', () => {
  it('refuses a past expiry with a message', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findAllByText('MAT-0001')
    await user.click(
      screen.getByRole('button', { name: 'Register replacement lot' }),
    )
    await user.type(screen.getByLabelText(/Lot number/), 'LOT-B')
    await user.type(screen.getByLabelText(/Expiry/), '2020-01-01')
    await user.type(screen.getByLabelText(/Quantity/), '4')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(registerReplacementLot).not.toHaveBeenCalled()
    expect(screen.getByText('The expiry must be today or later.')).toBeTruthy()
    expect(screen.getByLabelText(/Expiry/).getAttribute('aria-invalid')).toBe(
      'true',
    )
  })

  it('explains a missing quantity instead of returning silently', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findAllByText('MAT-0001')
    await user.click(
      screen.getByRole('button', { name: 'Register replacement lot' }),
    )
    await user.type(screen.getByLabelText(/Lot number/), 'LOT-B')
    await user.type(screen.getByLabelText(/Expiry/), '2099-01-01')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(registerReplacementLot).not.toHaveBeenCalled()
    expect(screen.getByText('Enter a quantity greater than zero.')).toBeTruthy()
  })

  it('registers a replacement lot with a future expiry', async () => {
    const user = userEvent.setup()
    renderRoute()

    await screen.findAllByText('MAT-0001')
    await user.click(
      screen.getByRole('button', { name: 'Register replacement lot' }),
    )
    await user.type(screen.getByLabelText(/Lot number/), 'LOT-B')
    await user.type(screen.getByLabelText(/Expiry/), '2099-01-01')
    await user.type(screen.getByLabelText(/Quantity/), '4')
    await user.click(screen.getByRole('button', { name: 'Register' }))

    await waitFor(() =>
      expect(registerReplacementLot).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          lot: 'LOT-B',
          expiry: '2099-01-01',
          quantity: 4,
        }),
      ),
    )
  })
})

describe('registering a first lot', () => {
  it('offers Register lot on an empty registry and creates the lot', async () => {
    fixtures.reagents = []
    vi.mocked(createReagent).mockResolvedValue(
      makeReagent({ id: 'mat-9', identifier: 'MAT-0009' }),
    )
    const user = userEvent.setup()
    renderRoute()

    expect(await screen.findByText('No lots in stock')).toBeTruthy()
    // Receive needs a selected lot; Register does not.
    expect(
      screen
        .getByRole('button', { name: 'Receive lot' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await user.click(screen.getAllByRole('button', { name: 'Register lot' })[0])
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(
        within(dialog).getByRole('option', { name: 'Project A' }),
      ).toBeTruthy(),
    )
    await user.selectOptions(within(dialog).getByLabelText(/Project/), 'p-1')
    await user.type(within(dialog).getByLabelText(/Material/), 'Sodium acetate')
    await user.type(within(dialog).getByLabelText(/Quantity/), '250')
    await user.type(within(dialog).getByLabelText(/Unit/), 'g')
    await user.click(within(dialog).getByRole('button', { name: 'Register' }))

    await waitFor(() =>
      expect(createReagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectId: 'p-1',
          title: 'Sodium acetate',
          properties: expect.objectContaining({ quantity: 250, unit: 'g' }),
        }),
      ),
    )
  })

  it('says why a lot cannot be registered without a name or quantity', async () => {
    fixtures.reagents = []
    const user = userEvent.setup()
    renderRoute()

    await screen.findByText('No lots in stock')
    await user.click(screen.getAllByRole('button', { name: 'Register lot' })[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Register' }))

    expect(createReagent).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Enter the material name.')).toBeTruthy()
    expect(
      within(dialog).getByText('Enter a quantity greater than zero.'),
    ).toBeTruthy()
  })
})

describe('?selected= across tabs', () => {
  it('switches to the tab that holds the linked lot', async () => {
    fixtures.reagents = [
      makeReagent(),
      makeReagent({
        id: 'mat-2',
        identifier: 'MAT-0002',
        status: 'quarantined',
      }),
    ]
    search.value = { selected: 'mat-2' }
    const calls: NavigateCall[] = []
    navigate.fn = (options) => calls.push(options)
    renderRoute()

    await waitFor(() => expect(calls).toHaveLength(1))

    // SAFETY: the linked-lot move is the only navigate call this screen makes with a search up-date function, which is what the call above is recorded for.
    const options = calls[0] as NavigateFunctionCall

    expect(options.search({ selected: 'mat-2' })).toMatchObject({
      tab: 'quarantine',
      selected: 'mat-2',
    })
  })
})
