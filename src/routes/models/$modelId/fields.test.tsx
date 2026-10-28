/**
 * J-DAT-12 — the "No version yet" empty state points at the control that
 * exists (Edit model, then Start draft) and links to it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Route } from './fields'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useParams: () => ({ modelId: '00000000-0000-4000-8000-00000000d001' }),
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('#/components/v3/models/models-data', () => ({
  useModelVersions: () => ({ data: [], isLoading: false }),
  useModelFields: () => ({ data: [], isLoading: false }),
  useModelDefinition: () => ({ data: null, isLoading: false }),
}))

afterEach(cleanup)

describe('Model fields tab — no version', () => {
  it('links to Edit model and names who can start a version', () => {
    const Fields = Route.options.component as React.ComponentType
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Fields />
      </QueryClientProvider>,
    )

    expect(screen.getByText('No version yet')).toBeTruthy()
    expect(screen.queryByText(/from the header/)).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Edit model' }).getAttribute('href'),
    ).toBe('/models/$modelId/edit')
    expect(screen.getByText(/choose Start draft/)).toBeTruthy()
    expect(screen.getByText(/owners and admins/)).toBeTruthy()
  })
})
