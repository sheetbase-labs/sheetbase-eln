import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LocationInput } from './location-field'

afterEach(cleanup)

describe('LocationInput', () => {
  it('offers the given locations as suggestions and keeps free typing', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <LocationInput
          aria-label="New location"
          value=""
          onChange={() => {}}
          locations={['Freezer 1 / Rack 2', 'Bench']}
        />
      </QueryClientProvider>,
    )
    const input = container.querySelector('input')!
    const list = container.querySelector('datalist')!
    expect(input.getAttribute('list')).toBe(list.id)
    expect(
      [...list.querySelectorAll('option')].map((o) => o.getAttribute('value')),
    ).toEqual(['Freezer 1 / Rack 2', 'Bench'])
  })
})
