/**
 * The reagent lot page: Use records a consume movement through the stock RPC,
 * refuses more than is left, and the ledger lists every movement.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { recordReagentMovement } from '#/lib/reagent-data'
import type * as ReagentData from '#/lib/reagent-data'
import type { ReagentMovement } from '#/lib/reagent-data'
import type * as MaterialSafetyLib from '#/lib/material-safety'
import { Route } from './$lotId'
import { movementChange } from './-lot-page-model'

// oxlint-disable-next-line anti-slop/no-module-mocking -- The favourite toggle reads the signed-in person's favourites through its own query; this suite is about the lot page's stock movements.
vi.mock('#/components/favourites/favourite-toggle', () => ({
  FavouriteToggle: () => null,
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The file-route factory is bound to the generated route tree at build time; this suite renders the route's own component with the params the shell would supply.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component?: React.ComponentType }) => ({
    useParams: () => ({ lotId: 'lot-1' }),
    options: config,
  }),
  getRouteApi: () => ({}),
  redirect: (options: { to: string }) => options,
  Link: ({
    to,
    children,
    ...props
  }: {
    to?: string
    children?: React.ReactNode
  } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) => (
    <a href={to ?? '#'} {...props}>
      {children}
    </a>
  ),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Toasts are painted by the app shell's Toaster, which a jsdom render mounts nothing of; this suite never reads them.
vi.mock('#/components/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The notebook client opens over the app's transport at import time; nothing on this page reads it.
vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Capability checks read the signed-in person's workspace; this suite renders the write affordances, so the boundary answers yes.
vi.mock('#/lib/use-capability', () => ({ useHasCapability: () => true }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- The safety sheet is a separate read with its own suite; only the one hazard record this page shows is fixed here, and every other export stays the library's own.
vi.mock('#/lib/material-safety', async (importOriginal) => {
  const actual = await importOriginal<typeof MaterialSafetyLib>()

  return {
    ...actual,
    fetchMaterialSafety: vi.fn(async () => ({
      recordId: 'lot-1',
      pictograms: ['GHS02'],
      signalWord: 'danger',
      hazardStatements: ['H225'],
      sheet: null,
      updatedAt: '2026-11-04T00:00:00Z',
    })),
  }
})

// oxlint-disable-next-line anti-slop/no-module-mocking -- Identifier resolution asks the database; this suite renders the route with the lot id the shell would supply.
vi.mock('#/lib/identifier-resolution', () => ({
  resolveIdentifierParam: vi.fn(),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- User names are a server read; the ledger's actor column is the only place this suite reads one.
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ names: {}, userLabel: () => 'Ada L.' }),
}))

// oxlint-disable-next-line anti-slop/no-module-mocking -- Every reagent read on this page goes through this module; the doubles keep its real mappers and answer with the one lot, ledger and certificate the assertions describe.
vi.mock('#/lib/reagent-data', async (importOriginal) => {
  const actual = await importOriginal<typeof ReagentData>()

  return {
    ...actual,
    fetchReagent: vi.fn(async () => ({
      id: 'lot-1',
      identifier: 'MAT-0001',
      title: 'Tris buffer',
      status: 'available',
      metadataVersion: 4,
      supplier: 'Sigma',
      catalogNo: null,
      lot: 'L1',
      expiry: '2099-05-01',
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
    })),
    fetchReagentMovements: vi.fn(async () => [
      {
        id: 'm-2',
        reagentRecordId: 'lot-1',
        operation: 'consume',
        quantityDelta: 1,
        resultingQuantity: 5,
        unit: 'mL',
        supplier: null,
        catalogNo: null,
        lot: null,
        expiry: null,
        reason: 'Used in EXP-0001',
        actorUserId: 'u-1',
        createdAt: '2026-02-01T10:00:00Z',
      },
      {
        id: 'm-1',
        reagentRecordId: 'lot-1',
        operation: 'receive',
        quantityDelta: 6,
        resultingQuantity: 6,
        unit: 'mL',
        supplier: null,
        catalogNo: null,
        lot: null,
        expiry: null,
        reason: null,
        actorUserId: 'u-1',
        createdAt: '2026-01-01T10:00:00Z',
      },
    ]),
    fetchReagentUsage: vi.fn(async () => []),
    fetchReplacementLot: vi.fn(async () => null),
    fetchCertificateFile: vi.fn(async () => ({
      fileRecordId: 'f-1',
      identifier: 'FILE-1',
      displayName: 'coa.pdf',
      mediaType: 'application/pdf',
    })),
    recordReagentMovement: vi.fn(async () => undefined),
  }
})

// SAFETY: `$lotId.tsx` registers its page as the route's component, so the factory above always supplies one.
const LotPage = Route.options.component as React.ComponentType

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={client}>
      <LotPage />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('lot page', () => {
  it('shows the hazards of the material', async () => {
    renderPage()
    expect(
      (await screen.findAllByRole('img', { name: 'Flammable' })).length,
    ).toBeGreaterThan(0)
    expect(await screen.findByText('H225')).toBeTruthy()
    expect(screen.getByText('Highly flammable liquid and vapour')).toBeTruthy()
  })

  it('lists the ledger and the certificate', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: /Ledger/ }))
    expect(await screen.findByText('Used in EXP-0001')).toBeTruthy()
    expect(screen.getByText('−1 mL')).toBeTruthy()
    expect(screen.getByText('+6 mL')).toBeTruthy()
    expect(await screen.findByText('coa.pdf')).toBeTruthy()
  })

  it('records a use as a consume movement', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Use' }))
    await user.type(screen.getByLabelText(/Quantity/), '2')
    await user.click(screen.getAllByRole('button', { name: 'Use' }).at(-1)!)
    await waitFor(() => expect(recordReagentMovement).toHaveBeenCalled())
    expect(vi.mocked(recordReagentMovement).mock.calls[0][1]).toMatchObject({
      recordId: 'lot-1',
      operation: 'consume',
      quantityDelta: 2,
      expectedMetadataVersion: 4,
    })
  })

  it('refuses more than is left', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Use' }))
    await user.type(screen.getByLabelText(/Quantity/), '9')
    await user.click(screen.getAllByRole('button', { name: 'Use' }).at(-1)!)
    expect(await screen.findByText(/Only 5 mL is left/)).toBeTruthy()
    expect(recordReagentMovement).not.toHaveBeenCalled()
  })

  it('states a movement that moves no stock as a dash', () => {
    const quarantine: ReagentMovement = {
      id: 'm-0',
      reagentRecordId: 'lot-1',
      operation: 'quarantine',
      quantityDelta: 0,
      resultingQuantity: 5,
      unit: 'mL',
      supplier: null,
      catalogNo: null,
      lot: null,
      expiry: null,
      reason: null,
      actorUserId: 'u-1',
      createdAt: '2026-02-01T10:00:00Z',
    }

    expect(movementChange(quarantine)).toBe('—')
  })
})
