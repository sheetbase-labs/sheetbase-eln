import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SampleLabelCard } from './sample-label-card'

afterEach(cleanup)

describe('SampleLabelCard', () => {
  it('renders the label lines from the record and its hold window', () => {
    render(
      <SampleLabelCard
        host="app.sheetbase.test"
        record={{
          identifier: 'SMP-2231',
          title: 'Harvest lot HL-0934',
          sampleType: 'Cell harvest',
          barcode: 'SMP-LVV-0020',
          customFields: { batch: 'HL-0934' },
          createdAt: '2026-09-20T00:00:00.000Z',
          properties: { holdCondition: '2–8 °C', holdUntil: '2026-10-04' },
        }}
      />,
    )
    expect(screen.getByText('SMP-2231')).toBeTruthy()
    expect(screen.getByText('HL-0934')).toBeTruthy()
    expect(screen.getByText('2–8 °C · use by 04-Oct')).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Printable label for SMP-2231' }),
    ).toBeTruthy()
  })

  it('encodes the DEC-10 payload so a scan resolves the sample', () => {
    render(
      <SampleLabelCard
        host="app.sheetbase.test"
        record={{ identifier: 'SMP-2231', customFields: {} }}
      />,
    )
    const code = screen.getByRole('img', {
      name: 'Label code resolving to https://app.sheetbase.test/r/SMP-2231',
    })
    // A real code, not the old fixed decorative pattern.
    const path = code.querySelector('path')
    expect(path?.getAttribute('d')).toBeTruthy()
    expect(path!.getAttribute('d')!.length).toBeGreaterThan(100)
  })

  it('draws no code when there is no host to resolve against', () => {
    render(<SampleLabelCard host="" record={{ identifier: 'SMP-2239' }} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No code')).toBeTruthy()
    expect(screen.getByText('SMP-2239')).toBeTruthy()
  })

  it('omits the storage line when no hold window is recorded', () => {
    render(
      <SampleLabelCard
        host="app.sheetbase.test"
        record={{ identifier: 'SMP-2232', customFields: {} }}
      />,
    )
    expect(screen.getByText('SMP-2232')).toBeTruthy()
    expect(screen.queryByText(/use by/)).toBeNull()
    expect(screen.queryByText('HL-0934')).toBeNull()
  })

  it('ignores a non-string batch custom field', () => {
    render(
      <SampleLabelCard
        host="app.sheetbase.test"
        record={{ identifier: 'SMP-2233', customFields: { batch: 42 } }}
      />,
    )
    expect(screen.queryByText('42')).toBeNull()
  })
})
