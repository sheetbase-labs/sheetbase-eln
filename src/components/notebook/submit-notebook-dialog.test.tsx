import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotebookRecord } from '#/lib/notebook-data'
import { SubmitNotebookDialog } from './submit-notebook-dialog'
import { fetchWorkspaceMembers } from '#/lib/workspace-admin'
import { requestSignatureStepUp } from '#/lib/signatures'
import { fetchWorkspaceCertifications } from '#/lib/signature-certification'

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAvailableReviewWorkflows: vi.fn(async () => [
    {
      definition_key: 'default-scientific-review',
      version: 1,
      requires_signature: false,
    },
    {
      definition_key: 'controlled-scientific-review',
      version: 1,
      requires_signature: true,
    },
  ]),
  previewSubmissionDigest: vi.fn(),
  submitRecordRevision: vi.fn(),
}))

vi.mock('#/lib/signatures', async (importOriginal) => ({
  ...(await importOriginal()),
  requestSignatureStepUp: vi.fn(),
}))

vi.mock('#/lib/signature-certification', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceCertifications: vi.fn(async () => {
    throw new Error('certification read unavailable')
  }),
}))

vi.mock('#/lib/workspace-admin', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceMembers: vi.fn(),
}))

const names = vi.hoisted<{ byId: Record<string, string> }>(() => ({
  byId: {},
}))

vi.mock('#/lib/user-names', () => ({
  useUserNames: (ids: string[]) => ({
    names: Object.fromEntries(ids.map((id) => [id, names.byId[id] ?? id])),
    userLabel: (id: string) => names.byId[id] ?? id,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
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
  vi.clearAllMocks()
  names.byId = {}
})

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const testRecord: NotebookRecord = {
  id: 'r1',
  projectId: 'p1',
  kind: 'experiment',
  identifier: 'EXP-001',
  title: 'Binding assay',
  status: 'working',
  tags: [],
  structureVersion: 3,
  metadataVersion: 1,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

describe('SubmitNotebookDialog', () => {
  it('does not offer a reviewer who lacks review access to the project', async () => {
    names.byId = { '22222222-reviewer': 'Mei L.', u1: 'Gareth P.' }
    const { notebookDataClient } = await import('#/lib/notebook-data')
    vi.spyOn(notebookDataClient, 'rpc').mockResolvedValue([{ user_id: 'u1' }])
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([
      {
        id: 'm1',
        workspaceId: 'ws',
        userId: 'u1',
        role: 'scientist',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        workspaceId: 'ws',
        userId: '22222222-reviewer',
        role: 'reviewer',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        workspaceId="ws"
        record={testRecord}
      />,
    )
    expect(
      await screen.findByText(/no review access to this project/),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('checkbox', { name: /Mei L\./ })
        .hasAttribute('data-disabled'),
    ).toBe(true)
    vi.mocked(notebookDataClient.rpc).mockRestore()
  })

  it('refuses a reviewer who cannot open a draft experiment', async () => {
    names.byId = { '22222222-reviewer': 'Mei L.', u1: 'Gareth P.' }
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 1,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([
      {
        id: 'm1',
        workspaceId: 'ws',
        userId: 'u1',
        role: 'scientist',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        workspaceId: 'ws',
        userId: '22222222-reviewer',
        role: 'reviewer',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        workspaceId="ws"
        record={{ ...testRecord, status: 'draft' }}
      />,
    )
    await user.click(await screen.findByText('Mei L. · reviewer'))
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    expect(
      await screen.findByText(/cannot open a draft experiment/),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('requires a snapshot check and a reviewer before submit', async () => {
    names.byId = { '22222222-reviewer': 'Mei L.', u1: 'Gareth P.' }
    const { previewSubmissionDigest, submitRecordRevision } =
      await import('#/lib/notebook-data')
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 1,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })
    vi.mocked(submitRecordRevision).mockResolvedValue({
      revision: { id: 'rev-1', integrityDigest: 'abc123digest' },
      submission: { id: 'sub-1', state: 'submitted' },
      idempotent: false,
    })
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([
      {
        id: 'm1',
        workspaceId: 'ws',
        userId: 'u1',
        role: 'scientist',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        workspaceId: 'ws',
        userId: '22222222-reviewer',
        role: 'reviewer',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        workspaceId="ws"
        record={testRecord}
      />,
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(await screen.findByText('You (scientist)')).toBeTruthy()
    // Candidates are identified by name, never by the shared uuid prefix.
    await user.click(await screen.findByText('Mei L. · reviewer'))
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    expect(
      await screen.findByText(/Integrity check: abc123digest/),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      false,
    )
    fireEvent.change(screen.getByLabelText('Review due date'), {
      target: { value: '2026-10-15' },
    })
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitRecordRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reviewerUserIds: ['22222222-reviewer'],
        dueAt: new Date('2026-10-15T00:00:00').toISOString(),
      }),
    )
    expect(requestSignatureStepUp).not.toHaveBeenCalled()
  })

  it('names every reviewer candidate instead of the shared uuid prefix', async () => {
    names.byId = {
      '00000000-0000-4000-8000-000000000310': 'Gareth P.',
      '00000000-0000-4000-8000-000000000311': 'Priya S.',
    }
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([
      {
        id: 'm1',
        workspaceId: 'ws',
        userId: '00000000-0000-4000-8000-000000000311',
        role: 'reviewer',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        workspaceId: 'ws',
        userId: '00000000-0000-4000-8000-000000000310',
        role: 'owner',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ])
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="00000000-0000-4000-8000-000000000310"
        workspaceId="ws"
        record={testRecord}
      />,
    )

    expect(await screen.findByText('Priya S. · reviewer')).toBeTruthy()
    expect(screen.getByText('You (owner)')).toBeTruthy()
    expect(screen.queryByText(/00000000 · /)).toBeNull()
  })

  it('binds Authored password proof to the exact controlled submission arguments', async () => {
    const { previewSubmissionDigest, submitRecordRevision } =
      await import('#/lib/notebook-data')
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'a'.repeat(64),
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 7,
    })
    vi.mocked(requestSignatureStepUp).mockResolvedValue({
      token: 'bound-password-token',
      expiresAt: '2026-10-04T12:05:00Z',
      authMethod: 'password',
    })
    vi.mocked(submitRecordRevision).mockResolvedValue({
      revision: { id: 'rev-controlled', integrityDigest: 'a'.repeat(64) },
      submission: { id: 'sub-controlled', state: 'submitted' },
      idempotent: false,
    })
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        workspaceId="ws"
        record={testRecord}
      />,
    )
    await screen.findByRole('option', { name: /Controlled scientific review/ })
    await user.selectOptions(
      screen.getByLabelText('Review workflow'),
      'controlled-scientific-review/1',
    )
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    await screen.findByText(/Integrity check:/)
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
    fireEvent.change(screen.getByLabelText('Review due date'), {
      target: { value: '2026-10-15' },
    })
    await user.type(
      screen.getByLabelText('Author signing password'),
      'native-fixture-password',
    )
    await user.type(
      screen.getByLabelText('Author signature confirmation'),
      'Actual Author',
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(submitRecordRevision).toHaveBeenCalledTimes(1))
    const dueAt = new Date('2026-10-15T00:00:00').toISOString()
    expect(requestSignatureStepUp).toHaveBeenCalledWith({
      workspaceId: 'ws',
      purpose: 'author-submit',
      password: 'native-fixture-password',
      recordId: 'r1',
      revisionDigest: 'a'.repeat(64),
      workflowDefinitionKey: 'controlled-scientific-review',
      workflowDefinitionVersion: 1,
      reviewerUserIds: ['u1'],
      confirmed: true,
      idempotencyKey: expect.any(String),
      dueAt,
    })
    const issued = vi.mocked(requestSignatureStepUp).mock.calls[0][0]
    if (issued.purpose !== 'author-submit')
      throw new Error('Expected author proof')
    expect(submitRecordRevision).toHaveBeenCalledWith(expect.anything(), {
      recordId: 'r1',
      expectedSourceDigest: 'a'.repeat(64),
      workflowDefinitionKey: 'controlled-scientific-review',
      workflowDefinitionVersion: 1,
      reviewerUserIds: ['u1'],
      idempotencyKey: issued.idempotencyKey,
      dueAt,
      authorSigningToken: 'bound-password-token',
      authorConfirmationPhrase: 'Actual Author',
    })
    expect(screen.getByLabelText('Author signing password')).toHaveProperty(
      'value',
      '',
    )
  })

  it('says up front that an uncertified author cannot sign, and links to settings', async () => {
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    vi.mocked(fetchWorkspaceCertifications).mockResolvedValueOnce([])
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        workspaceId="ws"
        record={testRecord}
      />,
    )
    await screen.findByRole('option', { name: /Controlled scientific review/ })
    await user.selectOptions(
      screen.getByLabelText('Review workflow'),
      'controlled-scientific-review/1',
    )
    await screen.findByText(/signature is not certified for this workspace/)
    expect(
      screen
        .getByRole('link', { name: 'Open signature settings' })
        .getAttribute('href'),
    ).toBe('/settings/my-signature')
    expect(
      screen.getByLabelText('Author signing password').matches(':disabled'),
    ).toBe(true)
  })

  it('never freezes an unsigned controlled submission after password proof fails', async () => {
    const { previewSubmissionDigest, submitRecordRevision } =
      await import('#/lib/notebook-data')
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'b'.repeat(64),
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 7,
    })
    vi.mocked(requestSignatureStepUp).mockRejectedValue(
      new Error('Signing is locked for 15 minutes.'),
    )
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        workspaceId="ws"
        record={testRecord}
      />,
    )
    await screen.findByRole('option', { name: /Controlled scientific review/ })
    await user.selectOptions(
      screen.getByLabelText('Review workflow'),
      'controlled-scientific-review/1',
    )
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    await screen.findByText(/Integrity check:/)
    await user.type(
      screen.getByLabelText('Author signing password'),
      'wrong-password',
    )
    await user.type(
      screen.getByLabelText('Author signature confirmation'),
      'Actual Author',
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    await screen.findByText('Signing is locked for 15 minutes.')
    expect(submitRecordRevision).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Author signing password')).toHaveProperty(
      'value',
      '',
    )
    expect(
      screen.queryByRole('region', { name: 'Evidence preview' }),
    ).toBeNull()
  })

  it('fails the readiness checklist and blocks submit while drafts are unsaved', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 2,
      metadataVersion: 1,
      calculationInputRevision: 7,
    })
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        record={testRecord}
        hasUnsavedWork
      />,
    )
    expect(await screen.findByText('No unsaved drafts')).toBeTruthy()
    expect(
      screen.getByText(
        'Blocks with unsaved drafts are not part of the server snapshot — save or discard them before submitting.',
      ),
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    expect(
      await screen.findByText(/Integrity check: abc123digest/),
    ).toBeTruthy()
    // The digest verified, but the unsaved-draft failure still blocks.
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('previews what submission will pin, labelled as a preview not evidence', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 2,
      metadataVersion: 1,
      calculationInputRevision: 7,
    })
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        record={testRecord}
        blocks={[
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
                    content: [{ type: 'text', text: 'Results summary.' }],
                  },
                ],
              },
            },
            payloadSchemaVersion: 1,
            order: 2,
            version: 1,
          },
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
        ]}
      />,
    )
    // No preview before the server verifies the snapshot.
    expect(
      screen.queryByRole('region', { name: 'Evidence preview' }),
    ).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    const previewRegion = await screen.findByRole('region', {
      name: 'Evidence preview',
    })
    expect(previewRegion.textContent).toContain('not yet evidence')
    expect(previewRegion.textContent).toContain('2 blocks')
    expect(previewRegion.textContent).toContain('structure version 2')
    // Blocks render read-only in document order.
    const headings = within(previewRegion).getAllByText('Objective')
    expect(headings.length).toBeGreaterThan(0)
    expect(within(previewRegion).getByText('Results summary.')).toBeTruthy()
  })

  it('lists embedded Sheets as manual checks that link to the Sheet surface', async () => {
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
        record={testRecord}
        blocks={[
          {
            id: 'b1',
            recordId: 'r1',
            type: 'sheet',
            payload: { instanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
            payloadSchemaVersion: 1,
            order: 1,
            version: 1,
          },
        ]}
      />,
    )
    expect(
      screen.getByText('Embedded Sheets checked for pending edits'),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Sheet evidence is captured at submission time. This dialog cannot see pending cell edits inside a Sheet — confirm each Sheet is saved on the Sheet itself.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Sheet aaaaaaaa' }).getAttribute('href'),
    ).toBe('/sheets/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })

  it('invalidates the verified snapshot when a block changes after verification', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const block = {
      id: 'b1',
      recordId: 'r1',
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Before edit.' }],
            },
          ],
        },
      },
      payloadSchemaVersion: 1,
      order: 1,
      version: 1,
    }
    const ui = (currentBlocks: Array<typeof block>) => (
      <QueryClientProvider client={client}>
        <SubmitNotebookDialog
          open
          onOpenChange={vi.fn()}
          recordId="r1"
          projectId="p1"
          reviewerUserId="u1"
          record={testRecord}
          blocks={currentBlocks}
        />
      </QueryClientProvider>
    )
    const user = userEvent.setup()
    const { rerender } = render(ui([block]))
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    expect(
      await screen.findByText(/Integrity check: abc123digest/),
    ).toBeTruthy()
    expect(
      screen.getByRole('region', { name: 'Evidence preview' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      false,
    )

    // A live block edit lands after verification: payload change + version.
    rerender(
      ui([
        {
          ...block,
          version: 2,
          payload: {
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'After.' }],
                },
              ],
            },
          },
        },
      ]),
    )

    // The dialog must not stay "verified" against the stale digest: the
    // frozen preview is cleared, the checklist drops back to pending, and
    // Submit disables until the snapshot is re-checked.
    expect(
      screen.queryByRole('region', { name: 'Evidence preview' }),
    ).toBeNull()
    expect(screen.queryByText(/Integrity check: abc123digest/)).toBeNull()
    expect(screen.getByText(/changed since the last check/)).toBeTruthy()
    expect(screen.getByTestId('submission-readiness').textContent).toContain(
      'Run “Check snapshot”',
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('invalidates the verified snapshot when record metadata changes after verification', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
    vi.mocked(previewSubmissionDigest).mockResolvedValue({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const ui = (currentRecord: NotebookRecord) => (
      <QueryClientProvider client={client}>
        <SubmitNotebookDialog
          open
          onOpenChange={vi.fn()}
          recordId="r1"
          projectId="p1"
          reviewerUserId="u1"
          record={currentRecord}
        />
      </QueryClientProvider>
    )
    const user = userEvent.setup()
    const { rerender } = render(ui(testRecord))
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    expect(
      await screen.findByText(/Integrity check: abc123digest/),
    ).toBeTruthy()

    // Title edit bumps metadata: the verified binding must drop.
    rerender(ui({ ...testRecord, title: 'Renamed assay', metadataVersion: 2 }))

    expect(screen.queryByText(/Integrity check: abc123digest/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('discards the verification response when inputs change while the check is in flight', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
    // Hold the RPC pending until the test releases it, simulating a slow
    // preview_submission_digest while the Notebook is edited.
    const deferred: {
      resolve:
        | ((value: Awaited<ReturnType<typeof previewSubmissionDigest>>) => void)
        | null
    } = { resolve: null }
    vi.mocked(previewSubmissionDigest).mockImplementation(
      () =>
        new Promise((resolve) => {
          deferred.resolve = resolve
        }),
    )
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([])
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const block = {
      id: 'b1',
      recordId: 'r1',
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Before edit.' }],
            },
          ],
        },
      },
      payloadSchemaVersion: 1,
      order: 1,
      version: 1,
    }
    const ui = (currentBlocks: Array<typeof block>) => (
      <QueryClientProvider client={client}>
        <SubmitNotebookDialog
          open
          onOpenChange={vi.fn()}
          recordId="r1"
          projectId="p1"
          reviewerUserId="u1"
          record={testRecord}
          blocks={currentBlocks}
        />
      </QueryClientProvider>
    )
    const user = userEvent.setup()
    const { rerender } = render(ui([block]))

    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))

    // The inputs change while the digest RPC is still pending.
    rerender(
      ui([
        {
          ...block,
          version: 2,
          payload: {
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'After.' }],
                },
              ],
            },
          },
        },
      ]),
    )

    // The response lands for content that is no longer on screen.
    deferred.resolve!({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })

    // The stale response must NOT enable a verified preview: no evidence
    // preview region, no verified digest line, no invalidation lie — the
    // checklist stays pending and Submit stays disabled.
    await waitFor(() => {
      expect(vi.mocked(previewSubmissionDigest)).toHaveBeenCalled()
    })
    expect(
      screen.queryByRole('region', { name: 'Evidence preview' }),
    ).toBeNull()
    expect(screen.queryByText(/Integrity check: abc123digest/)).toBeNull()
    expect(screen.getByTestId('submission-readiness').textContent).toContain(
      'Run “Check snapshot”',
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })
})
