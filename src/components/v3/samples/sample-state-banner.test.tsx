import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Button } from '#/components/v3/ui/button'
import type { SampleRecord } from '#/lib/samples'

import { SampleStateBanner } from './sample-state-banner'

afterEach(cleanup)

function sample(overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    id: 's-1',
    projectId: null,
    kind: 'sample',
    identifier: 'SMP-2220',
    title: 'pAAV9-RC, lot P-117',
    status: 'available',
    tags: [],
    structureVersion: 1,
    metadataVersion: 3,
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T11:20:00.000Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u-1',
    updatedByUserId: null,
    properties: {},
    customFields: {},
    lockedAt: null,
    lockedByRevisionId: null,
    sampleType: 'Plasmid',
    quantity: 12.5,
    quantityUnit: 'mg',
    storageLocation: 'F-3',
    barcode: null,
    lowStockThreshold: null,
    notes: null,
    holdCondition: null,
    holdStartedAt: null,
    holdDurationDays: null,
    holdUntil: null,
    allowedUseExperimentIds: null,
    quarantineReason: null,
    quarantinedAt: null,
    disposalReason: null,
    disposedAt: null,
    releasedAt: null,
    releaseChecks: null,
    ...overrides,
  }
}

describe('SampleStateBanner', () => {
  it('renders nothing for a normal sample', () => {
    const { container } = render(<SampleStateBanner sample={sample()} />)
    expect(container.textContent).toBe('')
  })

  it('renders the quarantine banner with its action', () => {
    render(
      <SampleStateBanner
        sample={sample({
          status: 'quarantined',
          quarantineReason: 'Endotoxin pending',
        })}
        action={<Button size="sm">View release checks</Button>}
      />,
    )
    expect(screen.getByText(/Endotoxin pending/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'View release checks' }),
    ).toBeTruthy()
  })

  it('renders the hold-exceeded banner as an alert', () => {
    render(
      <SampleStateBanner
        sample={sample({
          status: 'hold_exceeded',
          holdDurationDays: 7,
          holdCondition: '2–8 °C',
        })}
      />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/Hold limit passed/)).toBeTruthy()
  })
})
