import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'

import {
  ProjectErrorState,
  ProjectUnavailableState,
  RecordListSection,
} from './$projectId'

// Stub the router Link as a plain anchor that interpolates $params so no
// route tree is required. createFileRoute/redirect are stubbed so the route
// module loads without a router context.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    useRouteContext: () => ({}),
    useParams: () => ({ projectId: 'p1' }),
  }),
  redirect: (opts: unknown) => opts,
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to?: string
    params?: Record<string, string>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    let href = typeof to === 'string' ? to : '#'
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        href = href.replace(`$${k}`, encodeURIComponent(v))
      }
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

afterEach(() => {
  cleanup()
})

describe('ProjectErrorState', () => {
  it('shows a generic error and retry control', () => {
    render(<ProjectErrorState error={new Error('down')} onRetry={() => {}} />)
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load the project.',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('surfaces a permission message for permission_denied errors', () => {
    const err = new DataClientError('permission_denied', 'no', 403)
    render(<ProjectErrorState error={err} onRetry={() => {}} />)
    expect(screen.getByRole('alert').textContent).toBe(
      'You do not have access to this project.',
    )
  })
})

describe('ProjectUnavailableState', () => {
  it('explains the project is gone or restricted and links back', () => {
    render(<ProjectUnavailableState />)
    expect(
      screen.getByRole('heading', { name: 'Project unavailable' }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to projects' })).toBeTruthy()
  })
})

describe('RecordListSection', () => {
  const baseProps = {
    onRetry: () => {},
    userLabel: (id: string) => id,
  }

  it('shows a loading state', () => {
    render(
      <RecordListSection
        {...baseProps}
        records={[]}
        isLoading={true}
        error={null}
      />,
    )
    const loading = screen.getByText('Loading records…')
    expect(loading.getAttribute('aria-busy')).toBe('true')
  })

  it('shows an error state with retry', () => {
    render(
      <RecordListSection
        {...baseProps}
        records={[]}
        isLoading={false}
        error={new Error('down')}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load records.',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('shows an empty state when no records exist', () => {
    render(
      <RecordListSection
        {...baseProps}
        records={[]}
        isLoading={false}
        error={null}
      />,
    )
    expect(screen.getByText('No notebook records yet')).toBeTruthy()
  })

  it('renders a deep link per record with identifier and status', () => {
    render(
      <RecordListSection
        {...baseProps}
        records={[
          {
            id: 'r1',
            projectId: 'p1',
            kind: 'experiment',
            identifier: 'EXP-2025-0001',
            title: 'Virus Stability at 4C',
            status: 'in-progress',
            tags: ['stability'],
            structureVersion: 1,
            metadataVersion: 1,
            createdAt: '2026-07-18T12:00:00.000Z',
            updatedAt: '2026-07-18T12:00:00.000Z',
            archivedAt: null,
            deletedAt: null,
            createdByUserId: 'u1',
            updatedByUserId: null,
            properties: {},
            lockedAt: null,
            lockedByRevisionId: null,
          },
        ]}
        isLoading={false}
        error={null}
      />,
    )
    const link = screen.getByRole('link', { name: /Virus Stability at 4C/ })
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/records/r1')
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    // Status badge vocabulary label
    expect(screen.getByText('In progress')).toBeTruthy()
  })

  it('sends workspace catalogue records to their canonical catalogue', () => {
    render(
      <RecordListSection
        {...baseProps}
        records={[
          {
            id: 'sample-1',
            projectId: 'p1',
            kind: 'sample',
            identifier: 'SAM-0001',
            title: 'Reference sample',
            status: 'available',
            tags: [],
            structureVersion: 1,
            metadataVersion: 1,
            createdAt: '2026-07-18T12:00:00.000Z',
            updatedAt: '2026-07-18T12:00:00.000Z',
            archivedAt: null,
            deletedAt: null,
            createdByUserId: 'u1',
            updatedByUserId: null,
            properties: {},
            lockedAt: null,
            lockedByRevisionId: null,
          },
        ]}
        isLoading={false}
        error={null}
      />,
    )
    expect(
      screen
        .getByRole('link', { name: /Reference sample/ })
        .getAttribute('href'),
    ).toBe('/samples?selected=sample-1')
  })
})
