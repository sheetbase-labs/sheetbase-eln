/**
 * EXP-04.5 — view-only and signed notebook presentation.
 *
 * The read-only path (a project viewer, an archived or signed record) must
 * offer exactly what a reader can still do: copy, comment, and ask for edit
 * access through the existing SET-02 RPC. A signed record additionally shows
 * the signatures it is bound to. Every action is asserted against its real
 * effect — the RPC call, the clipboard write, the block's own comment
 * affordance — not merely its button's presence.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { DataClientError } from '#/lib/data-client'
import type * as notebookDataModule from '#/lib/notebook-data'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import type { SignatureWire } from '#/lib/signatures'

import { NotebookDocument } from './notebook-document'

const { rpcMock, listMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  listMock: vi.fn(),
}))

// NOTE-03: block previews build canonical Open affordances with TanStack Link.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

// The real wrappers run against this client, so the RPC name and arguments are
// asserted, not a stub of the wrapper itself.
vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal<typeof notebookDataModule>()),
  notebookDataClient: { rpc: rpcMock, list: listMock },
}))

// Collaboration on and the room mounted, so the block comment affordance is
// actually present to open.
vi.mock('#/lib/collaboration/liveblocks.config', () => ({
  useCollaborationEnabled: () => true,
  useThreads: () => ({ threads: [] }),
  useOthers: () => [],
  useUpdateMyPresence: () => () => {},
}))

vi.mock('#/components/collaboration/collaboration-room', () => ({
  useCollaborationRoomReady: () => true,
}))

vi.mock('#/components/collaboration/thread-panel', () => ({
  ThreadPanel: () => <div data-testid="thread-panel" />,
  threadMatchesAnchor: () => false,
}))

beforeAll(() => {
  document.elementFromPoint = () => null
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  rpcMock.mockReset()
  listMock.mockReset()
})

const record: NotebookRecord = {
  id: 'r1',
  projectId: 'p1',
  kind: 'experiment',
  identifier: 'EXP-2025-0001',
  title: 'Virus Stability',
  status: 'in-progress',
  tags: [],
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

const signedRecord: NotebookRecord = {
  ...record,
  status: 'approved',
  lockedAt: '2026-09-19T10:05:00.000Z',
  lockedByRevisionId: 'revision-1',
}

function richTextBlock(id: string, text: string): NotebookBlock {
  return {
    id,
    recordId: 'r1',
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
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

function signature(
  overrides: Partial<SignatureWire> & { id: string },
): SignatureWire {
  return {
    workspace_id: 'workspace',
    submission_id: 'submission',
    revision_id: 'revision-1',
    record_id: 'r1',
    signature_meaning: 'reviewed',
    assurance_level: 'standard',
    revision_integrity_digest: 'a'.repeat(64),
    signer_user_id: 'user-2',
    signer_session_id: 'session-2',
    signer_role: 'reviewer',
    auth_method: 'password',
    confirmation_phrase: 'Mei L.',
    signed_at: '2026-09-19T10:05:00Z',
    created_at: '2026-09-19T10:05:00Z',
    signer_name: 'Mei L.',
    ...overrides,
  }
}

function renderDocument(options: {
  record?: NotebookRecord
  blocks?: NotebookBlock[]
  readOnly?: boolean
  collaborationWorkspaceId?: string
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <NotebookDocument
        record={options.record ?? record}
        blocks={options.blocks ?? [richTextBlock('b1', 'Objective')]}
        readOnly={options.readOnly}
        collaborationWorkspaceId={options.collaborationWorkspaceId}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

describe('NotebookDocument — view-only mode (EXP-04.5)', () => {
  it('requests edit access through the SET-02 RPC and reports it as pending', async () => {
    const user = userEvent.setup()
    rpcMock.mockResolvedValue({ id: 'request-1' })
    renderDocument({ readOnly: true })

    await user.click(
      screen.getByRole('button', { name: 'Request edit access' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Reason for the access request' }),
      'QA verification of the turbidity repeat',
    )
    await user.click(screen.getByRole('button', { name: 'Send request' }))

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith('request_project_edit_access', {
        p_project_id: 'p1',
        p_reason: 'QA verification of the turbidity repeat',
      }),
    )
    // Pending approval — never reported as granted.
    expect(
      await screen.findByText(/Edit access requested — waiting for approval/),
    ).toBeTruthy()
  })

  it('shows the server refusal in its own words and does not claim success', async () => {
    const user = userEvent.setup()
    rpcMock.mockRejectedValue(
      new DataClientError(
        'permission_denied',
        'Readable project and workspace writer required',
        403,
      ),
    )
    renderDocument({ readOnly: true })

    await user.click(
      screen.getByRole('button', { name: 'Request edit access' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Reason for the access request' }),
      'Need to attach the calibration certificate',
    )
    await user.click(screen.getByRole('button', { name: 'Send request' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'Readable project and workspace writer required',
    )
    expect(screen.queryByText(/Edit access requested/)).toBeNull()
  })

  it('copies the reader’s selection to the clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '4.1 NTU',
    } as unknown as Selection)

    renderDocument({ readOnly: true })

    const copy = screen.getByRole('button', { name: 'Copy selection' })
    await waitFor(() => expect(copy.hasAttribute('disabled')).toBe(false))
    await user.click(copy)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('4.1 NTU'))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('opens the selected block’s comments from the view-only bar', async () => {
    const user = userEvent.setup()
    renderDocument({ readOnly: true, collaborationWorkspaceId: 'w1' })

    // No block selected yet: the action is offered but not yet usable.
    const comment = screen.getByRole('button', { name: 'Comment' })
    expect(comment.hasAttribute('disabled')).toBe(true)

    await user.click(document.getElementById('block-b1')!)
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Comment' })
          .hasAttribute('disabled'),
      ).toBe(false),
    )

    const blockComment = screen.getByRole('button', {
      name: 'Comments on block b1',
    })
    const opened = vi.fn()
    blockComment.addEventListener('click', opened)
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    expect(opened).toHaveBeenCalledTimes(1)
  })
})

describe('NotebookDocument — signed mode (EXP-04.5)', () => {
  it('is read-only and shows the signatures the record is bound to', async () => {
    listMock.mockResolvedValue([
      signature({
        id: 'SIG-8841',
        signature_meaning: 'authored',
        signer_name: 'Gareth P.',
        signed_at: '2026-09-18T16:22:00Z',
      }),
    ])
    renderDocument({ record: signedRecord, readOnly: true })

    // Read-only: no insert affordance.
    expect(screen.queryByRole('button', { name: /Add block/ })).toBeNull()

    const table = await screen.findByRole('table', { name: 'Signatures' })
    expect(within(table).getByText('Gareth P.')).toBeTruthy()
    expect(within(table).getByText('Authored')).toBeTruthy()
    expect(within(table).getByText('SIG-8841')).toBeTruthy()
    expect(listMock).toHaveBeenCalledWith(
      'signatures',
      '?record_id=eq.r1&order=signed_at.asc,id.asc',
    )
  })

  it('never renders an empty signatures table in place of a failed load', async () => {
    listMock.mockRejectedValue(new Error('offline'))
    renderDocument({ record: signedRecord, readOnly: true })

    expect(
      await screen.findByText('Signatures could not be loaded.'),
    ).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Signatures' })).toBeNull()
  })
})
