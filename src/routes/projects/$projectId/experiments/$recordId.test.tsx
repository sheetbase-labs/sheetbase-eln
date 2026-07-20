import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'

import {
  ArchivedBanner,
  EmptyNotebook,
  NotebookCanvas,
  NotebookErrorState,
  NotebookInspector,
  NotebookUnavailableState,
  PermissionRestrictedState,
  StickyRecordHeader,
} from './$recordId'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

// Stub the router Link as a plain anchor that interpolates $params so no
// route tree is required. createFileRoute/redirect are stubbed so the route
// module loads without a router context.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({
    useRouteContext: () => ({}),
    useParams: () => ({ projectId: 'p1', recordId: 'r1' }),
  }),
  redirect: (opts: unknown) => opts,
  useBlocker: () => ({ status: 'idle' }),
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

const record: NotebookRecord = {
  id: 'r1',
  projectId: 'p1',
  kind: 'experiment',
  identifier: 'EXP-2025-0001',
  title: 'Virus Stability at 4C',
  status: 'in-progress',
  tags: ['stability', 'qPCR'],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T13:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u1',
  updatedByUserId: null,
}

const archivedRecord: NotebookRecord = {
  ...record,
  archivedAt: '2026-07-19T00:00:00.000Z',
}

describe('StickyRecordHeader', () => {
  it('shows the kind, identifier, status, title and project context', () => {
    render(
      <StickyRecordHeader record={record} projectName="Stability Programme" />,
    )
    expect(screen.getByText('Experiment')).toBeTruthy()
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: 'Virus Stability at 4C' }),
    ).toBeTruthy()
    expect(screen.getByText('Stability Programme')).toBeTruthy()
    // status badge renders the vocabulary label
    expect(screen.getByText('In progress')).toBeTruthy()
  })

  it('keeps tags in the properties inspector instead of the document header', () => {
    render(<StickyRecordHeader record={record} projectName={null} />)
    expect(screen.queryByText('stability')).toBeNull()
    expect(screen.queryByText('qPCR')).toBeNull()
  })
})

describe('ArchivedBanner', () => {
  it('announces the archived, read-only state', () => {
    render(<ArchivedBanner />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('archived')
    expect(status.textContent).toContain('read-only')
  })
})

describe('NotebookCanvas', () => {
  it('shows a loading state', () => {
    const { container } = render(
      <NotebookCanvas
        record={record}
        blocks={[]}
        isLoading={true}
        error={null}
        onRetry={() => {}}
      />,
    )
    const busy = container.querySelector('[aria-busy="true"]')
    expect(busy).toBeTruthy()
  })

  it('shows an error state with retry', () => {
    render(
      <NotebookCanvas
        record={record}
        blocks={[]}
        isLoading={false}
        error={new Error('down')}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load the notebook document.',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('shows the empty notebook state when there are no blocks', () => {
    render(
      <NotebookCanvas
        record={record}
        blocks={[]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    expect(
      screen.getByText('This notebook is ready for its first block'),
    ).toBeTruthy()
  })

  it('renders each block with a stable anchor id and read-only state when archived', () => {
    const blocks: NotebookBlock[] = [
      {
        id: 'b1',
        recordId: 'r1',
        type: 'heading',
        payload: { level: 1, text: 'Virus Stability' },
        payloadSchemaVersion: 1,
        order: 1,
        version: 1,
      },
      {
        id: 'b2',
        recordId: 'r1',
        type: 'rich_text',
        payload: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Objective text.' }],
              },
            ],
          },
        },
        payloadSchemaVersion: 1,
        order: 2,
        version: 1,
      },
    ]
    const { container } = render(
      <NotebookCanvas
        record={archivedRecord}
        blocks={blocks}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    expect(container.querySelector('#block-b1')).toBeTruthy()
    expect(container.querySelector('#block-b2')).toBeTruthy()
    // heading preview text renders
    expect(screen.getByText('Virus Stability')).toBeTruthy()
    expect(screen.getByText('Objective text.')).toBeTruthy()
    // archived record renders blocks read-only
    const readOnly = container.querySelectorAll('[data-state="read-only"]')
    expect(readOnly.length).toBe(2)
  })

  it('renders an unknown block type as a readable placeholder', () => {
    const blocks: NotebookBlock[] = [
      {
        id: 'bX',
        recordId: 'r1',
        type: 'quantum_state', // not in KNOWN_BLOCK_TYPES
        payload: { foo: 'bar' },
        payloadSchemaVersion: 1,
        order: 1,
        version: 1,
      },
    ]
    render(
      <NotebookCanvas
        record={record}
        blocks={blocks}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByText(/Unknown block type: quantum_state/)).toBeTruthy()
  })
})

describe('EmptyNotebook', () => {
  it('renders a helpful first-run message naming the identifier', () => {
    render(<EmptyNotebook record={record} />)
    expect(
      screen.getByRole('heading', {
        name: 'This notebook is ready for its first block',
      }),
    ).toBeTruthy()
    expect(screen.getByText(/EXP-2025-0001/)).toBeTruthy()
  })
})

describe('NotebookErrorState', () => {
  it('maps permission_denied to an access message', () => {
    const err = new DataClientError('permission_denied', 'no', 403)
    render(<NotebookErrorState error={err} onRetry={() => {}} />)
    expect(screen.getByRole('alert').textContent).toBe(
      'You do not have access to this notebook.',
    )
  })

  it('shows a retry control', () => {
    render(<NotebookErrorState error={new Error('x')} onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('NotebookUnavailableState', () => {
  it('renders an honest unavailable state with a back-to-project link', () => {
    render(<NotebookUnavailableState projectId="p1" />)
    expect(
      screen.getByRole('heading', { name: 'Notebook unavailable' }),
    ).toBeTruthy()
    const back = screen.getByRole('link', { name: 'Back to project' })
    expect(back.getAttribute('href')).toBe('/projects/p1')
  })
})

describe('PermissionRestrictedState', () => {
  it('renders a permission-restricted message', () => {
    render(<PermissionRestrictedState />)
    expect(
      screen.getByRole('heading', { name: 'Permission restricted' }),
    ).toBeTruthy()
  })
})

describe('NotebookInspector', () => {
  it('renders overview properties and a links tab with a count', () => {
    render(
      <NotebookInspector
        record={record}
        links={[
          {
            id: 'l1',
            sourceRecordId: 'r1',
            targetRecordId: 'r2',
            targetKind: 'protocol_template',
            targetIdentifier: 'PRT-2025-0001',
            linkType: 'protocol',
          },
        ]}
        linksLoading={false}
      />,
    )
    // Identity header
    expect(screen.getByText('Virus Stability at 4C')).toBeTruthy()
    // Overview tab is the default; identifier appears in PropertyList
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    // Links tab badge
    const linksTab = screen.getByRole('tab', { name: /Links/ })
    expect(linksTab.textContent).toContain('1')
  })

  it('shows a loading hint for links while they load', () => {
    render(
      <NotebookInspector
        record={record}
        links={[]}
        linksLoading={true}
        defaultTab="links"
      />,
    )
    expect(screen.getByText('Loading links…')).toBeTruthy()
  })
})

describe('NotebookCanvas — editable path', () => {
  it('renders the block picker when a client and queryClient are supplied', () => {
    const queryClient = new QueryClient()
    const fakeClient = {
      list: () => Promise.resolve([]),
      insert: () => Promise.resolve({}),
      rpc: () => Promise.resolve({}),
    } as unknown as DataClient
    render(
      <QueryClientProvider client={queryClient}>
        <NotebookCanvas
          record={record}
          blocks={[
            {
              id: 'b1',
              recordId: 'r1',
              type: 'heading',
              payload: { level: 2, text: 'Editable' },
              payloadSchemaVersion: 1,
              order: 1,
              version: 1,
            },
          ]}
          isLoading={false}
          error={null}
          onRetry={() => {}}
          client={fakeClient}
          queryClient={queryClient}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('button', { name: /Add block/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Editable' })).toBeTruthy()
    expect(screen.queryByLabelText('Heading text')).toBeNull()
  })
})
