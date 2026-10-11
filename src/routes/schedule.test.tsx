/**
 * ADR-0054 / R5-CONFIG-06 — Schedule books instruments.
 *
 * The route is rendered over the real read models with only the `/api/db`
 * boundary faked, so the reader (which instruments are bookable), the week grid
 * and the picker all run for real: each grid row is an instrument linking to
 * /instruments/$id with its INS display id, and the picker offers the same
 * instruments by display id and name.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as router from '@tanstack/react-router'
import type * as notebookData from '#/lib/notebook-data'

import { Schedule } from './schedule'

const AMBR = '00000000-0000-4000-8000-0000000003e1'
const PR01 = '00000000-0000-4000-8000-0000000003e0'

const fake = vi.hoisted(() => {
  const list = async (resource: string) => {
    switch (resource) {
      case 'instruments':
        return [
          {
            id: '00000000-0000-4000-8000-0000000003e0',
            display_id: 'INS-0007',
            name: 'Plate reader PR-01',
            location: null,
            retired_at: null,
          },
          {
            id: '00000000-0000-4000-8000-0000000003e1',
            display_id: 'INS-0008',
            name: 'Ambr 250',
            location: 'bay 2',
            retired_at: null,
          },
          {
            id: '00000000-0000-4000-8000-0000000003df',
            display_id: 'INS-0006',
            name: 'Retired reader',
            location: null,
            retired_at: '2026-09-01T00:00:00.000Z',
          },
        ]
      default:
        return []
    }
  }
  return { list, rpc: async () => [] }
})

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<typeof notebookData>()),
  notebookDataClient: fake,
}))

vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof router>()
  return {
    ...actual,
    createFileRoute: () => (options: object) => ({
      options,
      useRouteContext: () => ({
        context: {
          user: { id: 'user-1' },
          workspace: { id: 'ws-1', name: 'Process Development' },
        },
      }),
    }),
    redirect: vi.fn(),
    Link: ({
      to,
      children,
      params,
      ...rest
    }: React.ComponentProps<'a'> & {
      to?: unknown
      params?: Record<string, string>
    }) => {
      const href =
        typeof to === 'string' && params
          ? Object.entries(params).reduce(
              (path, [key, value]) => path.replace(`$${key}`, value),
              to,
            )
          : typeof to === 'string'
            ? to
            : '#'
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      )
    },
  }
})

afterEach(cleanup)

function renderSchedule() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Schedule />
    </QueryClientProvider>,
  )
}

describe('ADR-0054 Schedule', () => {
  it('links each grid row to its instrument with the INS display id', async () => {
    renderSchedule()

    const ambr = await screen.findByRole('link', { name: /INS-0008/ })
    expect(ambr.getAttribute('href')).toBe(`/instruments/${AMBR}`)
    expect(ambr.textContent).toContain('Ambr 250')

    const plate = screen.getByRole('link', { name: /INS-0007/ })
    expect(plate.getAttribute('href')).toBe(`/instruments/${PR01}`)
    expect(plate.textContent).toContain('Plate reader PR-01')

    // A retired instrument is not a Schedule row at all.
    expect(screen.queryByRole('link', { name: /INS-0006/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Retired reader/ })).toBeNull()
  })

  it('offers the instruments by display id and name in the picker', async () => {
    const user = userEvent.setup()
    renderSchedule()
    await screen.findByRole('link', { name: /INS-0008/ })

    await user.click(screen.getByRole('button', { name: 'Book instrument' }))
    const dialog = screen.getByRole('dialog')
    const options = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).toEqual([
      'Choose…',
      'INS-0007 · Plate reader PR-01',
      'INS-0008 · Ambr 250',
    ])
  })
})
