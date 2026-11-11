/**
 * J-INS-04 / J-INS-06 — the parser page reached from a failed import tells a
 * person without edit rights who can act, and lets an approver get back to the
 * import they were fixing.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ParserTestFile,
  ParserSettingsRow,
  ParserVersionStatus,
} from '#/lib/parser-settings'

interface ParserFixtureState {
  status: ParserVersionStatus
  requestedAt: string | undefined
}

const state: ParserFixtureState = {
  status: 'approved',
  requestedAt: undefined,
}

const unexpected: string[] = []

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    'http://localhost',
  )

  if (!init?.method || init.method === 'GET') {
    const resource = url.pathname.replace('/api/db/', '')

    switch (resource) {
      case 'parsers': {
        if (!url.searchParams.has('workspace_id')) return Response.json([])

        const rows: ParserSettingsRow[] = [
          {
            id: 'p1',
            key: 'plate-export',
            name: 'Plate export',
            format: 'csv',
            instrument_id: null,
            instruments: null,
            parser_versions: [
              {
                id: 'v1',
                version: 1,
                status: state.status === 'draft' ? 'draft' : 'approved',
                signature: {},
                mapping: {},
                test_result: null,
                validated_at: null,
                approved_at: null,
                approved_by_user_id: null,
              },
            ],
          },
        ]

        return Response.json(rows)
      }

      case 'dataset_import_files': {
        const rows: ParserTestFile[] = [
          {
            id: 'file-1',
            filename: 'plate-7.csv',
            checksum: 'abc',
            parser_failure: {
              message: 'Unrecognised headers',
              requestedAt: state.requestedAt,
            },
          },
        ]

        return Response.json(rows)
      }

      case 'instruments':
      case 'instrument_calibrations':
      case 'dataset_imports':
      case 'extensions':
        return Response.json([])
    }
  }

  unexpected.push(`${init?.method ?? 'GET'} ${url}`)
  throw new Error(`Unexpected parser settings request: ${url}`)
})

const { ParserSettings } = await import('./parser-settings')
const { dropSharedReads } = await import('#/lib/data-client')

afterEach(() => {
  cleanup()
  state.status = 'approved'
  state.requestedAt = undefined
  dropSharedReads()
  expect(unexpected).toEqual([])
})

afterAll(() => vi.unstubAllGlobals())

function renderSettings(role: string, versionId?: string) {
  const root = createRootRoute()

  const settings = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <ParserSettings
        workspaceId="ws-1"
        role={role}
        fileId="file-1"
        versionId={versionId}
      />
    ),
  })

  const importRoute = createRoute({
    getParentRoute: () => root,
    path: '/import/$fileId',
  })

  const router = createRouter({
    routeTree: root.addChildren([settings, importRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('parser settings opened from a failed import', () => {
  it('tells a plain member who can act and links back to the import', async () => {
    state.status = 'draft'
    renderSettings('member')

    expect(
      await screen.findByText(/plate-7\.csv could not be read/),
    ).toBeTruthy()
    expect(screen.getByText(/Ask an admin or schema editor/)).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Back to the import' })
        .getAttribute('href'),
    ).toBe('/import/file-1?step=map')
  })

  it('says when an admin has already been asked', async () => {
    state.status = 'draft'
    state.requestedAt = '2026-10-17T10:00:00Z'
    renderSettings('member')

    expect(
      await screen.findByText(/already with them in their Inbox/),
    ).toBeTruthy()
  })

  it('offers the approver a link that resumes the original import', async () => {
    renderSettings('admin', 'v1')

    const resume = await screen.findByRole('link', {
      name: 'Resume the import',
    })

    expect(resume.getAttribute('href')).toBe(
      '/import/file-1?step=map&parser=plate-export',
    )
  })

  it('does not offer to resume before the parser is approved', async () => {
    state.status = 'draft'
    renderSettings('admin', 'v1')

    await screen.findByText(/plate-7\.csv could not be read/)
    expect(screen.queryByRole('link', { name: 'Resume the import' })).toBeNull()
  })
})
