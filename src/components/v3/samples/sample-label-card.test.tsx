import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SampleLabelCard } from './sample-label-card'

afterEach(cleanup)

describe('SampleLabelCard', () => {
  it('renders the printable label fields from the record', () => {
    render(
      <SampleLabelCard
        record={{
          identifier: 'SMP-2231',
          title: 'Harvest lot HL-0934',
          sampleType: 'Cell harvest',
          barcode: 'SMP-LVV-0020',
          customFields: { batch: 'HL-0934' },
        }}
      />,
    )
    expect(screen.getByText('SMP-2231')).toBeTruthy()
    expect(screen.getByText('HL-0934')).toBeTruthy()
    expect(screen.getByText('Cell harvest')).toBeTruthy()
    expect(screen.getByText('Barcode SMP-LVV-0020')).toBeTruthy()
    expect(
      screen.getByRole('group', { name: 'Printable label for SMP-2231' }),
    ).toBeTruthy()
  })

  it('says when no barcode is recorded instead of inventing one', () => {
    render(
      <SampleLabelCard record={{ identifier: 'SMP-2232', customFields: {} }} />,
    )
    expect(screen.getByText('Barcode not set')).toBeTruthy()
    expect(screen.queryByText('HL-0934')).toBeNull()
  })

  it('ignores a non-string batch custom field', () => {
    render(
      <SampleLabelCard
        record={{ identifier: 'SMP-2233', customFields: { batch: 42 } }}
      />,
    )
    expect(screen.queryByText('42')).toBeNull()
  })
})
