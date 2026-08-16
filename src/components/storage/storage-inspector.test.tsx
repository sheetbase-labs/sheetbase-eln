import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StorageInspector } from './storage-inspector'
import type { BoxPositionWithSample, StorageBox } from '#/lib/storage'

vi.mock('#/lib/notebook-data', () => ({
  formatDate: (date: string) => date,
  notebookDataClient: { list: vi.fn().mockResolvedValue([]) },
}))

afterEach(() => cleanup())

const box: StorageBox = {
  id: 'box-1',
  rackId: 'rack-1',
  name: 'LVV retention box 07',
  code: 'BX-LVV-07',
  rows: 3,
  cols: 4,
  capacity: 12,
  metadata: {},
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
}

const position: BoxPositionWithSample = {
  id: 'position-a1',
  boxId: box.id,
  rowIndex: 0,
  colIndex: 0,
  label: 'A1',
  status: 'occupied',
  occupiedRecordId: 'sample-1',
  metadata: {},
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
  sample: {
    id: 'sample-1',
    identifier: 'SMP-2025-0020',
    title: 'LVV-CAR-T retention aliquot',
    status: 'available',
    barcode: 'SMP-LVV-0020',
    sampleType: 'Drug substance',
  },
}

function renderInspector() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <StorageInspector
        position={position}
        box={box}
        positions={[position]}
        pendingSample={null}
        movements={[]}
        events={[]}
        onAction={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('StorageInspector', () => {
  it('keeps the selected sample identity and distinct position/sample states readable', () => {
    renderInspector()

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'LVV-CAR-T retention aliquot',
      }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('heading', { level: 2 })
        .classList.contains('text-balance'),
    ).toBe(true)
    expect(
      screen
        .getAllByText(
          (_content, element) =>
            element?.textContent === '● Position: Occupied',
        )
        .some((element) => element.tagName === 'SPAN'),
    ).toBe(true)
    expect(screen.getByText('Sample availability:')).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.queryByText('·')).toBeNull()
    expect(screen.getAllByText('Sample identifier').length).toBeGreaterThan(0)
    expect(screen.getByText('SMP-2025-0020')).toBeTruthy()
    expect(screen.getByText('Barcode')).toBeTruthy()
    expect(screen.getByText('SMP-LVV-0020')).toBeTruthy()
  })
})
