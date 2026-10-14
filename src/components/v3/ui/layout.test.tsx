import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { InspectorSection, PageHeader } from './layout'

afterEach(cleanup)

describe('Layout headings', () => {
  it('renders an inspector section at H2, so an inspector-only page never skips a level', () => {
    render(
      <InspectorSection title="Details">
        <p>body</p>
      </InspectorSection>,
    )

    expect(
      screen.getByRole('heading', { level: 2, name: 'Details' }),
    ).toBeTruthy()
  })

  it('names a page at H1 and puts a nested header one level below it', () => {
    render(
      <>
        <PageHeader title="Client portal" />
        <PageHeader title="ACME-01" titleLevel={2} />
      </>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Client portal' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 2, name: 'ACME-01' }),
    ).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
