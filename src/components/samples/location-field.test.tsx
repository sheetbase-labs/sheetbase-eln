import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LocationInput } from './location-field'
import { createDataClient } from '#/lib/data-client'

afterEach(cleanup)

describe('LocationInput', () => {
  it('offers the given locations as suggestions and keeps free typing', () => {
    const request = vi.fn(async () => Response.json([]))
    const onChange = vi.fn()

    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <LocationInput
          client={createDataClient(request)}
          aria-label="New location"
          value=""
          onChange={onChange}
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
    fireEvent.change(input, { target: { value: '  New bench  ' } })
    expect(onChange).toHaveBeenCalledWith('  New bench  ')
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps typed suggestions when storage setup cannot be read', async () => {
    const client = createDataClient(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      return url.pathname.endsWith('/sample_storage_locations')
        ? Response.json([{ location: 'Bench' }])
        : Response.json(
            { code: '42501', message: 'not available' },
            { status: 403 },
          )
    })

    const onChange = vi.fn()

    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <LocationInput
          client={client}
          aria-label="Location"
          value=""
          onChange={onChange}
        />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(container.querySelector('option')?.value).toBe('Bench'),
    )
    fireEvent.change(screen.getByLabelText('Location'), {
      target: { value: 'Unlisted freezer' },
    })
    expect(onChange).toHaveBeenCalledWith('Unlisted freezer')
  })
})
