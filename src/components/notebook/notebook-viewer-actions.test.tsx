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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { dropSharedReads } from '#/lib/data-client'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import type { SignatureWire } from '#/lib/signatures'

import { NotebookDocument } from './notebook-document'
import { NotebookViewerActions } from './notebook-viewer-actions'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

let signatures: SignatureWire[] = []
let signatureFailure = false
let accessDenied = false

beforeEach(() => {
  dropSharedReads()
  signatures = []
  signatureFailure = false
  accessDenied = false
  transport.mockReset()
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (url.pathname === '/api/db/rpc/request_project_edit_access') {
      return accessDenied
        ? Response.json(
            {
              code: 'permission_denied',
              message: 'Readable project and workspace writer required',
            },
            { status: 403 },
          )
        : Response.json({ id: 'request-1' })
    }

    if (url.pathname === '/api/db/signatures') {
      if (signatureFailure) throw new Error('offline')

      return Response.json(signatures)
    }

    if (url.pathname === '/api/db/comments') return Response.json([])
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
})

beforeAll(() => {
  document.elementFromPoint = () => null
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null })
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
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
      </RouterContextProvider>
    </QueryClientProvider>,
  )
}

describe('NotebookDocument — view-only mode (EXP-04.5)', () => {
  it('requests edit access through the SET-02 RPC and reports it as pending', async () => {
    const user = userEvent.setup()
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
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/request_project_edit_access',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_project_id: 'p1',
            p_reason: 'QA verification of the turbidity repeat',
          }),
        }),
      ),
    )
    // Pending approval — never reported as granted.
    expect(
      await screen.findByText(/Edit access requested — waiting for approval/),
    ).toBeTruthy()
  })

  it('shows the server refusal in its own words and does not claim success', async () => {
    const user = userEvent.setup()
    accessDenied = true
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

  it('copies only the owning document’s selection to the clipboard', async () => {
    userEvent.setup()

    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)

    const first = renderDocument({ readOnly: true })

    const second = renderDocument({
      readOnly: true,
      blocks: [richTextBlock('b1', '4.1 NTU')],
    })

    act(() => {
      const range = document.createRange()
      range.selectNodeContents(within(second.container).getByText('4.1 NTU'))
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    const copy = within(second.container).getByRole('button', {
      name: 'Copy selection',
    })

    expect(
      within(first.container)
        .getByRole('button', { name: 'Copy selection' })
        .hasAttribute('disabled'),
    ).toBe(true)
    await waitFor(() => expect(copy.hasAttribute('disabled')).toBe(false))
    fireEvent.click(copy)

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

  it('opens comments only in the second mounted copy of the same notebook', async () => {
    const user = userEvent.setup()

    const first = renderDocument({
      readOnly: true,
      collaborationWorkspaceId: 'w1',
    })

    const second = renderDocument({
      readOnly: true,
      collaborationWorkspaceId: 'w1',
    })

    const firstOpened = vi.fn()
    const secondOpened = vi.fn()
    within(first.container)
      .getByRole('button', { name: 'Comments on block b1' })
      .addEventListener('click', firstOpened)
    within(second.container)
      .getByRole('button', { name: 'Comments on block b1' })
      .addEventListener('click', secondOpened)

    await user.click(second.container.querySelector('[id="block-b1"]')!)
    await user.click(
      within(second.container).getByRole('button', { name: 'Comment' }),
    )

    expect(secondOpened).toHaveBeenCalledTimes(1)
    expect(firstOpened).not.toHaveBeenCalled()
  })
})

describe('NotebookDocument — signed mode (EXP-04.5)', () => {
  it('is read-only and shows the signatures the record is bound to', async () => {
    signatures = [
      signature({
        id: 'SIG-8841',
        signature_meaning: 'authored',
        signer_name: 'Gareth P.',
        signed_at: '2026-09-18T16:22:00Z',
      }),
    ]
    renderDocument({ record: signedRecord, readOnly: true })

    // Read-only: no insert affordance.
    expect(screen.queryByRole('button', { name: /Add block/ })).toBeNull()

    const table = await screen.findByRole('table', { name: 'Signatures' })
    expect(within(table).getByText('Gareth P.')).toBeTruthy()
    expect(within(table).getByText('Authored')).toBeTruthy()
    expect(within(table).getByText('SIG-8841')).toBeTruthy()
    expect(transport).toHaveBeenCalledWith(
      '/api/db/signatures?record_id=eq.r1&order=signed_at.asc,id.asc',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('never renders an empty signatures table in place of a failed load', async () => {
    signatureFailure = true
    renderDocument({ record: signedRecord, readOnly: true })

    expect(await screen.findByText('Couldn’t load the signatures')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Signatures' })).toBeNull()
  })
})

describe('reference copy status', () => {
  it('blames another pane only when it shows the same record', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NotebookViewerActions
          projectId="p1"
          commentEnabled={false}
          selectedBlockId={null}
          referenceCopy
          editingPane={{ identifier: 'EXP-0140', sameRecord: true }}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByRole('status').textContent).toMatch(
      /another pane is editing this record/,
    )
  })

  it('names the editing pane when it shows a different record', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NotebookViewerActions
          projectId="p1"
          commentEnabled={false}
          selectedBlockId={null}
          referenceCopy
          editingPane={{ identifier: 'EXP-0140', sameRecord: false }}
        />
      </QueryClientProvider>,
    )
    const message = screen.getByRole('status').textContent

    expect(message).toMatch(/editing happens in the EXP-0140 pane/)
    expect(message).not.toMatch(/editing this record/)
  })
})
