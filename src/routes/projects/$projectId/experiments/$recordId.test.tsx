import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'

import {
  ArchivedBanner,
  EmptyNotebook,
  HistoricalEvidenceBanner,
  LockedBanner,
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
    useSearch: () => ({}),
  }),
  redirect: (opts: unknown) => opts,
  useBlocker: () => ({ status: 'idle' }),
  useNavigate: () => vi.fn(),
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
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

const archivedRecord: NotebookRecord = {
  ...record,
  archivedAt: '2026-07-19T00:00:00.000Z',
}

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

describe('StickyRecordHeader', () => {
  it('shows the kind, identifier, status, title and project context', () => {
    renderWithQuery(
      <StickyRecordHeader
        record={record}
        projectName="Stability Programme"
        projectId="p1"
        currentUserId="u1"
      />,
    )
    expect(screen.getByText('Experiment')).toBeTruthy()
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    expect(screen.getByLabelText('Notebook title')).toBeTruthy()
    expect(screen.getByText('Stability Programme')).toBeTruthy()
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.getByText('Working')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
  })

  it('keeps tags in the properties inspector instead of the document header', () => {
    renderWithQuery(
      <StickyRecordHeader record={record} projectName={null} />,
    )
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

const lockedRecord: NotebookRecord = {
  ...record,
  lockedAt: '2026-07-26T12:00:00.000Z',
  lockedByRevisionId: 'rev-abcdef123456',
}

describe('HistoricalEvidenceBanner', () => {
  it('returns the scientist to the working Notebook', () => {
    render(
      <HistoricalEvidenceBanner projectId="p1" recordId="r1" />,
    )
    expect(screen.getByRole('status').textContent).toContain(
      'Viewing submitted evidence',
    )
    expect(
      screen.getByRole('link', { name: 'Return to working Notebook' }),
    ).toBeTruthy()
  })
})

describe('LockedBanner', () => {
  it('announces the locked, frozen state with the approved revision', () => {
    render(<LockedBanner record={lockedRecord} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('submitted')
    expect(status.textContent).toContain('frozen')
    expect(status.textContent).not.toContain('rev-abcd')
  })
})

describe('StickyRecordHeader — lock state', () => {
  it('shows a Submitted badge when the record is locked', () => {
    renderWithQuery(
      <StickyRecordHeader
        record={lockedRecord}
        projectName="Stability"
        projectId="p1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
      />,
    )
    expect(screen.getByText('Submitted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open review' })).toBeTruthy()
  })

  it('shows snapshot title in the header for a historical revision', () => {
    renderWithQuery(
      <StickyRecordHeader
        record={{
          ...record,
          title: 'Submitted title',
          tags: ['frozen-tag'],
        }}
        projectName="Stability"
        historicalRevisionId="rev-historical"
        liveLockedAt={null}
        liveLockedByRevisionId={null}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Submitted title' })).toBeTruthy()
    expect(screen.queryByLabelText('Notebook title')).toBeNull()
    expect(screen.getByText('Submitted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull()
  })

  it('shows Open review but not Sign while the submission is unsigned', () => {
    renderWithQuery(
      <StickyRecordHeader
        record={record}
        projectName="Stability"
        projectId="p1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
        review={{
          submission: {
            id: 'sub1',
            workspace_id: 'ws',
            record_id: 'r1',
            revision_id: 'rev-sub',
            state: 'submitted',
            workflow_definition_key: 'default-scientific-review',
            workflow_definition_version: 1,
            assigned_reviewer_user_ids: ['u1'],
            submitted_by_user_id: 'u1',
            submitted_session_id: 's',
            submitted_role: 'scientist',
            submitted_at: '2026-08-19T00:00:00.000Z',
            idempotency_key: 'k',
            created_at: '2026-08-19T00:00:00.000Z',
            updated_at: '2026-08-19T00:00:00.000Z',
          },
          revision: { id: 'rev-sub', superseded_by_revision_id: null },
        }}
      />,
    )
    expect(screen.getByText('In review')).toBeTruthy()
    expect(screen.queryByText('Working')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Open review' })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open review' }).getAttribute('href'),
    ).toContain('rev-sub')
  })

  it('shows Sign and Open review for an approved but still unlocked Notebook', () => {
    renderWithQuery(
      <StickyRecordHeader
        record={record}
        projectName="Stability"
        projectId="p1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
        review={{
          submission: {
            id: 'sub1',
            workspace_id: 'ws',
            record_id: 'r1',
            revision_id: 'rev-approved',
            state: 'approved',
            workflow_definition_key: 'default-scientific-review',
            workflow_definition_version: 1,
            assigned_reviewer_user_ids: ['u1'],
            submitted_by_user_id: 'u1',
            submitted_session_id: 's',
            submitted_role: 'scientist',
            submitted_at: '2026-08-19T00:00:00.000Z',
            idempotency_key: 'k',
            created_at: '2026-08-19T00:00:00.000Z',
            updated_at: '2026-08-19T00:00:00.000Z',
          },
          revision: { id: 'rev-approved', superseded_by_revision_id: null },
        }}
      />,
    )
    expect(screen.getByText('In review')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open review' })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open review' }).getAttribute('href'),
    ).toContain('rev-approved')
  })
})

describe('NotebookCanvas — locked record', () => {
  it('renders read-only when the record is locked (no client/queryClient)', () => {
    render(
      <NotebookCanvas
        record={lockedRecord}
        blocks={[
          {
            id: 'b1',
            recordId: lockedRecord.id,
            type: 'rich_text',
            payload: { doc: { type: 'doc', content: [] } },
            payloadSchemaVersion: 1,
            order: 0,
            version: 1,
          },
        ]}
        isLoading={false}
        error={null}
        onRetry={() => {}}
      />,
    )
    // The read-only document renders the block content without an add-block
    // control.
    expect(screen.queryByText('+ Block')).toBeNull()
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
        type: 'rich_text',
        payload: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Objective' }],
              },
            ],
          },
        },
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
    // structured heading and paragraph content render
    expect(screen.getByText('Objective')).toBeTruthy()
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
  it('renders Properties, History and Activity tabs with record metadata', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
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
        />
      </QueryClientProvider>,
    )
    // Three mockup tabs
    expect(screen.getByRole('tab', { name: 'Properties' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'History' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Comments' })).toBeNull()
    // Properties is the default; identifier appears in PropertyList
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    // Tags render as outline badges within Properties
    expect(screen.getByText('stability')).toBeTruthy()
    expect(screen.getByText('qPCR')).toBeTruthy()
  })

  it('shows frozen review status when the record is locked', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <NotebookInspector
          record={lockedRecord}
          links={[]}
          linksLoading={false}
          defaultTab="properties"
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText('Submitted — evidence frozen')).toBeTruthy()
    expect(screen.queryByText('Working')).toBeNull()
  })

  it('shows In review when a submission is active and the record is unlocked', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <NotebookInspector
          record={record}
          links={[]}
          linksLoading={false}
          defaultTab="properties"
          reviewActivity="submitted"
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText('In review')).toBeTruthy()
    expect(screen.queryByText('Working')).toBeNull()
    expect(screen.queryByText('Submitted — evidence frozen')).toBeNull()
  })

  it('renders snapshot title, tags and dates for a historical revision after live edits', () => {
    const queryClient = new QueryClient()
    const historical = {
      ...record,
      title: 'Submitted title',
      tags: ['frozen-tag'],
      updatedAt: '2026-07-18T12:00:00.000Z',
      lockedAt: null,
      lockedByRevisionId: null,
    }
    render(
      <QueryClientProvider client={queryClient}>
        <NotebookInspector
          record={historical}
          links={[]}
          linksLoading={false}
          defaultTab="properties"
          isHistorical
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText('frozen-tag')).toBeTruthy()
    expect(screen.queryByText('stability')).toBeNull()
    expect(screen.getByText('Submitted — evidence frozen')).toBeTruthy()
  })

  it('shows a loading hint for links while they load', () => {
    render(
      <NotebookInspector
        record={record}
        links={[]}
        linksLoading={true}
        defaultTab="properties"
      />,
    )
    expect(screen.getByText('Loading links…')).toBeTruthy()
  })

  it('shows an activity feed from change events attributed to the current user', () => {
    render(
      <NotebookInspector
        record={record}
        links={[]}
        linksLoading={false}
        currentUserId="u1"
        activity={[
          {
            id: 'e1',
            operation: 'create',
            entityType: 'block',
            actorUserId: 'u1',
            createdAt: '2026-07-18T12:30:00.000Z',
            payload: {},
          },
        ]}
        defaultTab="activity"
      />,
    )
    // The current user's own action is attributed as "You"
    expect(screen.getByText('You')).toBeTruthy()
    expect(screen.getByText(/created/)).toBeTruthy()
    expect(screen.getByText('a block')).toBeTruthy()
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
              type: 'rich_text',
              payload: {
                doc: {
                  type: 'doc',
                  content: [
                    {
                      type: 'heading',
                      attrs: { level: 2 },
                      content: [{ type: 'text', text: 'Editable' }],
                    },
                  ],
                },
              },
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
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
