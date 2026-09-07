/**
 * PlateInspector explain tests (ASSIST-01). The Validation section gains an
 * Explain affordance that renders a grounded, read-only panel — and offers
 * nothing when the well is valid.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlateDesignDoc, PlateWellAssignment } from '#/lib/plate-designer'

import { PlateInspector } from './plate-inspector'

afterEach(cleanup)

const well = {
  wellCode: 'B2',
  row: 1,
  col: 1,
  role: 'sample',
} as PlateWellAssignment
const design = {
  format: '96',
  rows: 8,
  cols: 12,
  wells: [well],
} as unknown as PlateDesignDoc

function renderInspector(
  errors: React.ComponentProps<typeof PlateInspector>['validationErrors'],
) {
  return render(
    <PlateInspector
      well={well}
      wellCode="B2"
      validationErrors={errors}
      design={design}
      saveHistory={[]}
      onEditWell={vi.fn()}
    />,
  )
}

describe('PlateInspector — explain surface (ASSIST-01)', () => {
  it('explains the well validation errors with cited rules', async () => {
    const user = userEvent.setup()
    renderInspector([
      {
        code: 'missing_sample_ref',
        field: 'wells[0]',
        message: 'Sample well B2 has no sample reference.',
        wellCode: 'B2',
      },
    ])
    await user.click(await screen.findByRole('button', { name: 'Explain' }))
    expect(
      await screen.findByText(/Why this plate design has issues/),
    ).toBeTruthy()
    expect(
      screen.getAllByText(/\[Plate rule missing_sample_ref\]/).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText(/Not authoritative/)).toBeTruthy()
  })

  it('offers no Explain affordance when the well is valid', () => {
    renderInspector([])
    expect(screen.getByText(/No issues/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Explain' })).toBeNull()
  })
})
