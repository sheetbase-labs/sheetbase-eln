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
  recordReagentMovement,
  registerReplacementLot,
} from '#/lib/reagent-data'
import type * as ReagentData from '#/lib/reagent-data'
import type { Reagent } from '#/lib/reagent-data'
import { Route } from './materials'

const fixtures = vi.hoisted(() => ({ reagents: [] as unknown[] }))
const search = vi.hoisted(() => ({ value: {} }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useSearch: () => search.value,
    useNavigate: () => vi.fn(),
    options: config,
  }),
  redirect: (options: unknown) => options,
  Link: ({
    to,
    children,
    ...props
  }: {
    to?: unknown
    children?: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

// The registry read and every write go through the domain library; mock only
// those, so the tests observe what the screen asks the boundary to do.
vi.mock('#/lib/reagent-data', async (importOriginal) => {
  const actual = await importOriginal<typeof ReagentData>()
  return {
    ...actual,
    fetchReagentsPage: vi.fn(async () => fixtures.reagents),
    fetchReagentsCount: vi.fn(async () => fixtures.reagents.length),
    recordReagentMovement: vi.fn(async () => undefined),
    registerReplacementLot: vi.fn(async () => undefined),
    fetchReagentUsage: vi.fn(async () => []),
    fetchReplacementLot: vi.fn(async () => null),
    fetchCertificateFile: vi.fn(async () => null),
  }
})

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
  const Component = Route.options.component
  if (!Component) throw new Error('Materials list component required')
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
})

describe('materials toolbar', () => {
  it('reorders the lots the route fetched when a sort key is chosen', async () => {
    const user = userEvent.setup()
    fixtures.reagents = [
      makeReagent({ id: 'mat-1', identifier: 'MAT-0001', expiry: '2027-05-01' }),
      makeReagent({ id: 'mat-2', identifier: 'MAT-0002', expiry: '2026-11-01' }),
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

    screen.getByRole('button', { name: 'Sort' }).focus()
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('menuitem', { name: 'ID' }))

    expect(ids()).toEqual(['MAT-0001', 'MAT-0002'])
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
    expect(
      screen.getByLabelText(/Quantity/).getAttribute('aria-invalid'),
    ).toBe('true')
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
