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
import { Route, movementChange } from './$lotId'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ lotId: 'lot-1' }),
    options: config,
  }),
  getRouteApi: () => ({}),
  redirect: (options: unknown) => options,
  Link: ({
    to,
    children,
    ...props
  }: { to?: unknown; children?: React.ReactNode } & Record<
    string,
    unknown
  >) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
vi.mock('#/lib/notebook-data', () => ({ notebookDataClient: {} }))
vi.mock('#/lib/identifier-resolution', () => ({
  resolveIdentifierParam: vi.fn(),
}))
vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ names: {}, userLabel: () => 'Ada L.' }),
}))
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
    expect(
      movementChange({ operation: 'quarantine', quantityDelta: 0 } as never),
    ).toBe('—')
  })
})
