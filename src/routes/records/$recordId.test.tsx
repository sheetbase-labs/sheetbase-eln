import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SheetProvenanceLine } from '#/components/sheet/canonical-sheet-workspace'
import { DataClientError } from '#/lib/data-client'
import type { DataClient } from '#/lib/data-client'
import { notebookQueryKeys } from '#/lib/notebook-data'
import * as commentsData from '#/lib/comments-data'

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
} from './$recordId/notebook'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

// Record router Link invocations so tests can assert canonical destinations.
const linkCalls = vi.hoisted(() => ({
  calls: [] as Array<{
    to?: string
    params?: Record<string, string>
    search?: Record<string, unknown>
  }>,
}))

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
    search,
    children,
    ...props
  }: {
    to?: string
    params?: Record<string, string>
    search?: Record<string, unknown>
    children: React.ReactNode
  } & Record<string, unknown>) => {
    linkCalls.calls.push({ to, params, search })
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
  linkCalls.calls.length = 0
})

// jsdom lacks the Range geometry prosemirror reads when the editor scrolls
// the selection into view after an undo/redo; stub it like the
// NotebookDocument tests do.
beforeAll(() => {
  document.elementFromPoint = () => null
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
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

/**
 * The header's print-only provenance line. On screen the record's kind, status,
 * notebook lifecycle, project and dates live in the inspector, where each is
 * labelled; the header itself is the title, the identifier and the actions.
 */
function provenance(): string {
  return (
    document.querySelector('[data-testid="record-provenance"]')?.textContent ??
    ''
  )
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
    expect(provenance()).toContain('Experiment')
    expect(screen.getByText('EXP-2025-0001')).toBeTruthy()
    expect(screen.getByLabelText('Notebook title')).toBeTruthy()
    expect(provenance()).toContain('Stability Programme')
    expect(provenance()).toContain('In progress')
    expect(provenance()).toContain('Working')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy()
    // The rare record actions live behind the overflow: a row of bordered
    // buttons above the work is chrome.
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
    expect(
      screen.getByRole('button', { name: 'More record actions' }),
    ).toBeTruthy()
  })

  it('leaves the title and identifier to the experiment page when embedded', () => {
    renderWithQuery(
      <StickyRecordHeader
        embedded
        record={record}
        projectName="Stability Programme"
        projectId="p1"
        currentUserId="u1"
      />,
    )
    expect(screen.queryByLabelText('Notebook title')).toBeNull()
    expect(screen.queryByText('EXP-2025-0001')).toBeNull()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy()
  })

  it('offers the rare record actions from the overflow', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <StickyRecordHeader
        record={record}
        projectName="Stability Programme"
        projectId="p1"
        currentUserId="u1"
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'More record actions' }),
    )
    const items = (await screen.findAllByRole('menuitem')).map((item) =>
      item.textContent.trim(),
    )
    expect(items).toContain('Print')
    expect(items).toContain('Duplicate')
    expect(items).toContain('Link records…')
  })

  it('offers Duplicate only for an experiment, never for a protocol', async () => {
    const user = userEvent.setup()
    renderWithQuery(
      <StickyRecordHeader
        record={{ ...record, kind: 'protocol_template' }}
        projectName="Stability Programme"
        projectId="p1"
        currentUserId="u1"
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'More record actions' }),
    )
    const items = (await screen.findAllByRole('menuitem')).map((item) =>
      item.textContent.trim(),
    )
    expect(items).not.toContain('Duplicate')
  })

  it('keeps tags in the properties inspector instead of the document header', () => {
    renderWithQuery(<StickyRecordHeader record={record} projectName={null} />)
    expect(screen.queryByText('stability')).toBeNull()
    expect(screen.queryByText('qPCR')).toBeNull()
  })

  // NOTE-04: the submit dialog's readiness checklist reflects the live
  // unsaved-draft signal routed from NotebookDocument.
  it('surfaces unsaved drafts in the submit dialog readiness checklist', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    renderWithQuery(
      <StickyRecordHeader
        record={record}
        projectName="Stability Programme"
        projectId="p1"
        currentUserId="u1"
        hasUnsavedWork
      />,
    )
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByText('No unsaved drafts')).toBeTruthy()
    // Scoped to the Readiness checklist group: the ASSIST-03 guide below
    // states the same warning in its own assistance voice.
    expect(
      within(await screen.findByRole('group', { name: 'Readiness' })).getByText(
        /save or discard them before submitting/i,
      ),
    ).toBeTruthy()
  })
})

describe('StickyRecordHeader withdraws a submission from the notebook menu', () => {
  const submission = (submittedBy: string) => ({
    submission: {
      id: 'sub1',
      workspace_id: 'ws',
      record_id: 'r1',
      revision_id: 'rev-sub',
      state: 'submitted',
      workflow_definition_key: 'default-scientific-review',
      workflow_definition_version: 1,
      assigned_reviewer_user_ids: ['u2'],
      submitted_by_user_id: submittedBy,
      submitted_session_id: 's',
      submitted_role: 'scientist',
      submitted_at: '2026-08-19T00:00:00.000Z',
      due_at: null,
      idempotency_key: 'k',
      created_at: '2026-08-19T00:00:00.000Z',
      updated_at: '2026-08-19T00:00:00.000Z',
    },
    revision: { id: 'rev-sub', superseded_by_revision_id: null },
  })

  async function menuItems(submittedBy: string) {
    renderWithQuery(
      <StickyRecordHeader
        record={record}
        projectName="Stability"
        projectId="p1"
        currentUserId="u1"
        review={submission(submittedBy)}
      />,
    )
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'More record actions' }))
    return (await screen.findAllByRole('menuitem')).map((item) =>
      item.textContent.trim(),
    )
  }

  it('offers Withdraw to the person who submitted it', async () => {
    expect(await menuItems('u1')).toContain('Withdraw from review…')
  })

  it('does not offer it to anyone else', async () => {
    expect(await menuItems('u2')).not.toContain('Withdraw from review…')
  })
})

describe('StickyRecordHeader reopens the task the person left', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('opens the Submit dialog on return from certifying a signature', async () => {
    window.history.replaceState(null, '', '/records/r1?reopen=submit')
    renderWithQuery(
      <StickyRecordHeader
        record={record}
        projectName="Stability Programme"
        projectId="p1"
        currentUserId="u1"
      />,
    )
    expect(await screen.findByRole('group', { name: 'Readiness' })).toBeTruthy()
  })

  it('leaves the dialog closed when nothing was left open', () => {
    renderWithQuery(
      <StickyRecordHeader
        record={record}
        projectName="Stability Programme"
        projectId="p1"
        currentUserId="u1"
      />,
    )
    expect(screen.queryByRole('group', { name: 'Readiness' })).toBeNull()
  })
})

describe('ArchivedBanner', () => {
  it('announces the archived, read-only state', () => {
    render(<ArchivedBanner />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('archived')
    expect(status.textContent).toContain('read-only')
  })

  it('J-NBK-17 restores the notebook and names who can when it is refused', async () => {
    const user = userEvent.setup()
    const onRestore = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('permission denied for table records'))
      .mockResolvedValueOnce({})
    render(<ArchivedBanner onRestore={onRestore} />)
    expect(screen.getByRole('status').textContent).toContain(
      'anyone who can edit the project can restore it',
    )
    await user.click(screen.getByRole('button', { name: 'Restore notebook' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'ask a project owner',
    )
    await user.click(screen.getByRole('button', { name: 'Restore notebook' }))
    expect(onRestore).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('J-NBK-17 sends the reader to project settings when the project is archived', () => {
    const onRestore = vi.fn()
    render(
      <ArchivedBanner projectId="p1" projectArchived onRestore={onRestore} />,
    )
    expect(
      screen
        .getByRole('link', { name: 'Open project settings' })
        .getAttribute('href'),
    ).toBe('/projects/p1/settings')
    expect(
      screen.queryByRole('button', { name: 'Restore notebook' }),
    ).toBeNull()
  })
})

const lockedRecord: NotebookRecord = {
  ...record,
  lockedAt: '2026-07-26T12:00:00.000Z',
  lockedByRevisionId: 'rev-abcdef123456',
}

describe('HistoricalEvidenceBanner', () => {
  it('returns the scientist to the working Notebook', () => {
    render(<HistoricalEvidenceBanner recordId="r1" />)
    expect(screen.getByRole('status').textContent).toContain(
      'Viewing submitted evidence',
    )
    expect(
      screen
        .getByRole('link', { name: 'Return to working Notebook' })
        .getAttribute('href'),
    ).toBe('/records/r1')
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
    expect(provenance()).toContain('Submitted')
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
        projectId="p1"
        historicalRevisionId="rev-historical"
        liveLockedAt={null}
        liveLockedByRevisionId={null}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Submitted title' }),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Notebook title')).toBeNull()
    expect(provenance()).toContain('Submitted')
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
  })

  it('hides Duplicate on a historical revision after amendment and live metadata edits', () => {
    renderWithQuery(
      <StickyRecordHeader
        record={{
          ...record,
          title: 'Submitted title',
          tags: ['frozen-tag'],
          lockedAt: null,
          lockedByRevisionId: null,
        }}
        projectName="Stability"
        projectId="p1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
        historicalRevisionId="rev-historical"
        liveLockedAt={null}
        liveLockedByRevisionId={null}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Submitted title' }),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(provenance()).toContain('Submitted')
  })

  it('keeps Duplicate on the working Notebook after amendment', () => {
    renderWithQuery(
      <StickyRecordHeader
        record={{
          ...record,
          title: 'Amended title',
          lockedAt: null,
          lockedByRevisionId: null,
        }}
        projectName="Stability"
        projectId="p1"
        currentUserId="u1"
      />,
    )
    expect(screen.getByLabelText('Notebook title')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'More record actions' }),
    ).toBeTruthy()
    expect(provenance()).toContain('Working')
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
            due_at: null,
            idempotency_key: 'k',
            created_at: '2026-08-19T00:00:00.000Z',
            updated_at: '2026-08-19T00:00:00.000Z',
          },
          revision: { id: 'rev-sub', superseded_by_revision_id: null },
        }}
      />,
    )
    expect(provenance()).toContain('In review')
    expect(provenance()).not.toContain('Working')
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
            due_at: null,
            idempotency_key: 'k',
            created_at: '2026-08-19T00:00:00.000Z',
            updated_at: '2026-08-19T00:00:00.000Z',
          },
          revision: { id: 'rev-approved', superseded_by_revision_id: null },
        }}
      />,
    )
    expect(provenance()).toContain('In review')
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
  it('renders view-only for a reader without record.create (EXP-04.5)', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <NotebookCanvas
          record={record}
          blocks={[
            {
              id: 'b1',
              recordId: record.id,
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
          client={{} as unknown as DataClient}
          queryClient={client}
          viewOnly
        />
      </QueryClientProvider>,
    )
    // The editable path is never handed to a viewer: no add-block control,
    // even though the record is neither archived nor locked.
    expect(screen.queryByText('+ Block')).toBeNull()
  })

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
        type: 'quantum_state', // not in BLOCK_TYPES
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
  it('renders an honest unavailable state with safe workspace navigation', () => {
    render(<NotebookUnavailableState />)
    expect(
      screen.getByRole('heading', { name: 'Notebook unavailable' }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'All projects' })).toBeTruthy()
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
              createdAt: '2026-08-03T00:00:00Z',
              createdByUserId: null,
            },
          ]}
          linksLoading={false}
        />
      </QueryClientProvider>,
    )
    // Canonical inspector tabs retain the existing metadata view.
    expect(screen.getByRole('tab', { name: 'Properties' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'History' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Comments' })).toBeTruthy()
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

  it('lists Record comments through the visibility-checked RPC without inventing a root target', async () => {
    const fetch = vi
      .spyOn(commentsData, 'fetchCommentsForRecord')
      .mockResolvedValue([])
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <NotebookInspector
          record={record}
          links={[]}
          linksLoading={false}
          defaultTab="comments"
          canEditMetadata
        />
      </QueryClientProvider>,
    )
    expect(
      await screen.findByText('No comments yet on this Record.'),
    ).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith(expect.anything(), record.id)
    expect(
      screen.queryByRole('textbox', { name: 'New comment body' }),
    ).toBeNull()
    fetch.mockRestore()
  })

  it('reads historical comments only from the exact loaded revision', async () => {
    const live = vi
      .spyOn(commentsData, 'fetchCommentsForRecord')
      .mockResolvedValue([])
    const frozen = vi
      .spyOn(commentsData, 'fetchCommentsForRevision')
      .mockResolvedValue([])
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <NotebookInspector
          record={record}
          links={[]}
          linksLoading={false}
          defaultTab="comments"
          isHistorical
          commentsRevisionId="historical-1"
          revisionEvidence={{ blocks: [], links: [] }}
          canEditMetadata
        />
      </QueryClientProvider>,
    )
    expect(
      await screen.findByText('No comments yet on this revision.'),
    ).toBeTruthy()
    expect(frozen).toHaveBeenCalledWith(expect.anything(), 'historical-1')
    expect(live).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('textbox', { name: 'New comment body' }),
    ).toBeNull()
    live.mockRestore()
    frozen.mockRestore()
  })

  it('does not fall back to live comments when historical evidence is missing', () => {
    const live = vi
      .spyOn(commentsData, 'fetchCommentsForRecord')
      .mockResolvedValue([])
    render(
      <NotebookInspector
        record={record}
        links={[]}
        linksLoading={false}
        defaultTab="comments"
        isHistorical
        commentsRevisionId="historical-1"
      />,
    )
    expect(
      screen.getByText('Comments are unavailable without revision evidence.'),
    ).toBeTruthy()
    expect(live).not.toHaveBeenCalled()
    live.mockRestore()
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

  it('does not leak live files, link editor or activity under historical evidence', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <NotebookInspector
          record={{
            ...record,
            title: 'Submitted title',
            tags: ['frozen-tag'],
          }}
          links={[
            {
              id: 'live-link',
              sourceRecordId: 'r1',
              targetRecordId: 'r-live',
              targetKind: 'dataset',
              targetIdentifier: 'LIVE-2026-9999',
              linkType: 'derived_from',
              createdAt: '2026-08-03T00:00:00Z',
              createdByUserId: null,
            },
          ]}
          linksLoading={false}
          blocks={[
            {
              id: 'live-file',
              recordId: 'r1',
              type: 'file',
              payload: {
                displayName: 'live-after-submit.pdf',
                mediaType: 'application/pdf',
                byteSize: 12,
                fileRecordId: 'file-live',
              },
              payloadSchemaVersion: 1,
              order: 1,
              version: 1,
            },
          ]}
          activity={[
            {
              id: 'e-live',
              operation: 'create',
              entityType: 'block',
              actorUserId: 'u1',
              createdAt: '2026-08-19T12:00:00.000Z',
              payload: {},
            },
          ]}
          currentUserId="u1"
          defaultTab="properties"
          isHistorical
          revisionEvidence={{
            blocks: [
              {
                id: 'snap-file',
                recordId: 'r1',
                type: 'file',
                payload: {
                  displayName: 'gel-at-submit.png',
                  mediaType: 'image/png',
                  byteSize: 4,
                  fileRecordId: 'file-snap',
                },
                payloadSchemaVersion: 1,
                order: 1,
                version: 1,
              },
            ],
            links: [
              {
                id: 'snap-link',
                sourceRecordId: 'r1',
                targetRecordId: 'r2',
                targetKind: 'protocol_template',
                targetIdentifier: 'PRT-FROZEN',
                linkType: 'protocol',
                createdAt: '2026-08-03T00:00:00Z',
                createdByUserId: null,
              },
            ],
          }}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText('gel-at-submit.png')).toBeTruthy()
    expect(screen.queryByText('live-after-submit.pdf')).toBeNull()
    expect(screen.queryByRole('link', { name: 'gel-at-submit.png' })).toBeNull()
    expect(screen.getByText('Protocols')).toBeTruthy()
    expect(screen.queryByText('Datasets')).toBeNull()
    expect(screen.queryByText('LIVE-2026-9999')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Link record' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull()
    expect(screen.queryByText('You created a block')).toBeNull()
    expect(screen.queryByText('You')).toBeNull()
  })

  it('shows a loading hint for links while they load', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <NotebookInspector
          record={record}
          links={[]}
          linksLoading={true}
          defaultTab="properties"
        />
      </QueryClientProvider>,
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
    expect(screen.getByRole('heading', { name: 'Editable' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

// NOTE-01: undo restores a deleted first block with one server-
// authoritative insert_block call that resolves position against both
// original neighbours (after=null, before=the survivor), so there is no
// second corrective move to fail. These tests prove the position contract
// end to end: the restored block re-lands at the head of the record from
// the RPC's (id, order) list, and a rejected insert writes nothing.
function blockWire(id: string, text: string, order: number) {
  return {
    id,
    record_id: 'r1',
    type: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text }],
          },
        ],
      },
    },
    payload_schema_version: 1,
    order,
    version: 1,
    created_at: '2026-07-18T12:00:00.000Z',
    updated_at: '2026-07-18T12:00:00.000Z',
  }
}

function richDomainBlock(id: string, text: string, order: number) {
  const wire = blockWire(id, text, order)
  return {
    id: wire.id,
    recordId: wire.record_id,
    type: wire.type,
    payload: wire.payload,
    payloadSchemaVersion: wire.payload_schema_version,
    order: wire.order,
    version: wire.version,
  }
}

describe('NotebookCanvas — undo delete position (NOTE-01)', () => {
  it('restores a deleted first block atomically via one insert_block with both anchors', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    queryClient.setQueryData(notebookQueryKeys.record('r1'), record)
    queryClient.setQueryData(notebookQueryKeys.blocks('r1'), [
      blockWire('b1', 'A', 1),
      blockWire('b2', 'B', 2),
    ])
    const blocksKey = notebookQueryKeys.blocks('r1')
    const cachedIds = () =>
      (queryClient.getQueryData<{ id: string }[]>(blocksKey) ?? []).map(
        (b) => b.id,
      )

    // delete_block removes the first block; undo re-inserts it in a single
    // server-authoritative RPC that resolves position against both anchors —
    // there is no second move to fail. The RPC returns the restored
    // (id, order) list, which the cache applies verbatim.
    const rpc = vi.fn(async (name: string) => {
      switch (name) {
        case 'delete_block':
          return { structure_version: 2, order: [{ id: 'b2', order: 2 }] }
        case 'insert_block':
          return {
            block: blockWire('b1-restored', 'A', 1),
            structure_version: 3,
            rebalanced: false,
            order: [
              { id: 'b1-restored', order: 1 },
              { id: 'b2', order: 2 },
            ],
          }
        default:
          throw new Error(`unexpected rpc: ${name}`)
      }
    })
    const fakeClient = {
      list: () => Promise.resolve([]),
      rpc,
    } as unknown as DataClient

    render(
      <QueryClientProvider client={queryClient}>
        <NotebookCanvas
          record={record}
          blocks={[
            richDomainBlock('b1', 'A', 1),
            richDomainBlock('b2', 'B', 2),
          ]}
          isLoading={false}
          error={null}
          onRetry={() => {}}
          client={fakeClient}
          queryClient={queryClient}
        />
      </QueryClientProvider>,
    )

    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[0],
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))

    // One RPC, positioned between both original neighbours (after=null,
    // before='b2' — the first-block case the old non-atomic undo could not
    // express and had to patch up with a second move).
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'insert_block',
      expect.objectContaining({
        p_record_id: 'r1',
        p_after_block_id: null,
        p_before_block_id: 'b2',
        p_expected_structure_version: 2,
      }),
    )
    // The restored block sits at its original position from the RPC's order
    // list; the undo status is dismissed as fully restored.
    expect(cachedIds()).toEqual(['b1-restored', 'b2'])
    expect(screen.queryByText('Block deleted.')).toBeNull()
  })

  it('writes nothing to the cache when the atomic insert fails', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    queryClient.setQueryData(notebookQueryKeys.record('r1'), record)
    queryClient.setQueryData(notebookQueryKeys.blocks('r1'), [
      blockWire('b1', 'A', 1),
      blockWire('b2', 'B', 2),
    ])
    const blocksKey = notebookQueryKeys.blocks('r1')
    const cachedIds = () =>
      (queryClient.getQueryData<{ id: string }[]>(blocksKey) ?? []).map(
        (b) => b.id,
      )

    // delete_block succeeds; the undo insert is rejected server-side. There
    // is no partial state to reconcile: the delete stands, nothing was
    // re-inserted, and the record stays honest about what exists.
    let deleted = false
    const rpc = vi.fn(async (name: string) => {
      switch (name) {
        case 'delete_block':
          deleted = true
          return { structure_version: 2, order: [{ id: 'b2', order: 2 }] }
        case 'insert_block':
          if (!deleted) throw new Error('undo offered before delete')
          throw new Error('restore rejected')
        default:
          throw new Error(`unexpected rpc: ${name}`)
      }
    })
    const fakeClient = {
      list: () => Promise.resolve([]),
      rpc,
    } as unknown as DataClient

    render(
      <QueryClientProvider client={queryClient}>
        <NotebookCanvas
          record={record}
          blocks={[
            richDomainBlock('b1', 'A', 1),
            richDomainBlock('b2', 'B', 2),
          ]}
          isLoading={false}
          error={null}
          onRetry={() => {}}
          client={fakeClient}
          queryClient={queryClient}
        />
      </QueryClientProvider>,
    )

    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[0],
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(cachedIds()).toEqual(['b2'])

    // The undo insert fails: no block is added, no order list applied.
    await expect(
      (async () => {
        await user.click(screen.getByRole('button', { name: 'Undo' }))
      })(),
    ).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith(
      'insert_block',
      expect.objectContaining({
        p_record_id: 'r1',
        p_after_block_id: null,
        p_before_block_id: 'b2',
      }),
    )
    expect(cachedIds()).toEqual(['b2'])
  })
})

describe('Sheet provenance — route-level navigation (NAV-02)', () => {
  it('resolves dataset provenance to the canonical /datasets?dataset=<uuid> route', () => {
    const datasetId = '770e8400-e29b-41d4-a716-446655440020'
    renderWithQuery(
      <SheetProvenanceLine
        columnLabel="Titer"
        columnOrigin="bound"
        provenance={{
          kind: 'present',
          provenance: {
            sourceKind: 'dataset',
            sourceDatasetId: datasetId,
            sourceRowId: null,
            sourceRevision: 3,
            sourceDatasetRevision: 9,
            bindingId: 'binding-1',
            sourceFieldId: 'field-1',
            definitionVersionId: 'def-1',
            definitionColumnId: 'col-1',
          } as never,
        }}
      />,
    )
    expect(screen.getByRole('link').textContent).toBe(datasetId)
    const last = linkCalls.calls[linkCalls.calls.length - 1]
    expect(last.to).toBe('/datasets')
    // Stable ID only: the explorer resolves the Dataset's lifecycle itself
    // and flips to the archived view when needed.
    expect(last.search).toEqual({ dataset: datasetId })
    expect(last.params).toBeUndefined()
  })

  it('resolves record provenance to the canonical /records/:recordId route', () => {
    const recordId = '660e8400-e29b-41d4-a716-446655440010'
    renderWithQuery(
      <SheetProvenanceLine
        columnLabel="Titer"
        columnOrigin="bound"
        provenance={{
          kind: 'present',
          provenance: {
            sourceKind: 'record',
            sourceRecordId: recordId,
            sourceMetadataVersion: 5,
            sourceFieldName: 'titer',
            bindingId: 'binding-1',
            sourceFieldId: 'field-1',
            definitionVersionId: 'def-1',
            definitionColumnId: 'col-1',
          } as never,
        }}
      />,
    )
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      `/records/${recordId}`,
    )
    const last = linkCalls.calls[linkCalls.calls.length - 1]
    expect(last.to).toBe('/records/$recordId')
    expect(last.params).toEqual({ recordId })
    expect(last.search).toBeUndefined()
  })
})
