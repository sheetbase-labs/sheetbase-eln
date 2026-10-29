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
import { runDefaultRevisionChecks } from '#/lib/review-checks'
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
  previewSubmissionDigest: vi.fn(async () => ({
    recordId: 'r1',
    sourceDigest: 'abc123digest',
    structureVersion: 1,
    metadataVersion: 1,
    calculationInputRevision: 1,
  })),
  submitRecordRevision: vi.fn(),
}))

vi.mock('#/lib/review-checks', () => ({
  runDefaultRevisionChecks: vi.fn(async () => ({})),
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

/** The automatic check of the notebook has finished (passed or failed). */
async function notebookChecked() {
  await waitFor(() =>
    expect(
      screen.getByTestId('submission-readiness').textContent,
    ).not.toContain('Checking your notebook'),
  )
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
  it('does not list a reviewer who lacks review access to the project', async () => {
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
    // Someone without review access to the project is not listed at all.
    await waitFor(() => expect(screen.queryByText(/Mei L\./)).toBeNull())
    expect(screen.getByText('You (Scientist)')).toBeTruthy()
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
    // Mei is the only other person who could review, so she is chosen.
    expect(await screen.findByText('Mei L. · Reviewer')).toBeTruthy()
    expect(
      await screen.findByText(/can’t open a draft experiment/),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('checks the notebook by itself and submits to the one other reviewer', async () => {
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
    // Nobody reviews their own work when someone else could, and candidates
    // are named, never shown by uuid prefix or role key.
    expect(await screen.findByText('Mei L. · Reviewer')).toBeTruthy()
    expect(screen.queryByText(/^You \(/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check snapshot' })).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
        'disabled',
        false,
      ),
    )
    // The digest, version numbers and hash are not shown.
    expect(document.body.textContent).not.toContain('abc123digest')
    expect(document.body.textContent).not.toMatch(/structure version/i)
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
    // The review opens with its checks already run.
    await waitFor(() =>
      expect(runDefaultRevisionChecks).toHaveBeenCalledWith(
        expect.anything(),
        'rev-1',
      ),
    )
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

    expect(await screen.findByText('Priya S. · Reviewer')).toBeTruthy()
    expect(screen.queryByText(/00000000 · /)).toBeNull()
    expect(screen.queryByText(/reviewer$/)).toBeNull()
  })

  it('offers the author as reviewer only when nobody else could review', async () => {
    names.byId = { u1: 'Gareth P.' }
    vi.mocked(fetchWorkspaceMembers).mockResolvedValue([
      {
        id: 'm1',
        workspaceId: 'ws',
        userId: 'u1',
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
        reviewerUserId="u1"
        workspaceId="ws"
        record={testRecord}
      />,
    )
    expect(await screen.findByText('You (Workspace Admin)')).toBeTruthy()
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
      screen.getByLabelText('Review type'),
      'controlled-scientific-review/1',
    )
    await notebookChecked()
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
      screen.getByLabelText('Review type'),
      'controlled-scientific-review/1',
    )
    await screen.findByText(/signature isn’t certified for this workspace/)
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
      screen.getByLabelText('Review type'),
      'controlled-scientific-review/1',
    )
    await notebookChecked()
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
    // A refusal sends the notebook back through its check, so the person can
    // try again without hunting for a button.
    await waitFor(() =>
      expect(vi.mocked(previewSubmissionDigest)).toHaveBeenCalledTimes(2),
    )
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
    expect(await screen.findByText('Everything is saved')).toBeTruthy()
    expect(
      screen.getByText(
        'Some blocks have changes that are not saved yet. Save or discard them before you submit.',
      ),
    ).toBeTruthy()
    // Unsaved work is not part of what would be checked, so no check runs.
    expect(vi.mocked(previewSubmissionDigest)).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('previews what will be sent, labelled as a preview not evidence', async () => {
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
    // No preview before the notebook has been checked.
    expect(screen.queryByRole('group', { name: 'Evidence preview' })).toBeNull()
    const previewRegion = await screen.findByRole('group', {
      name: 'Evidence preview',
    })
    expect(previewRegion.textContent).toContain('This is a preview')
    expect(previewRegion.textContent).toContain('2 blocks')
    expect(previewRegion.textContent).not.toMatch(/structure version/i)
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
    expect(screen.getByText('Sheets are saved')).toBeTruthy()
    expect(
      screen.getByText(
        'Open each sheet and make sure its latest cell edits are saved. This dialog can’t see edits inside a sheet.',
      ),
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Sheet aaaaaaaa' }).getAttribute('href'),
    ).toBe('/sheets/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
  })

  it('checks the notebook again when a block changes after it was checked', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
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
    const { rerender } = render(ui([block]))
    expect(
      await screen.findByRole('group', { name: 'Evidence preview' }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
        'disabled',
        false,
      ),
    )

    // The second check is held open so the in-between state can be read.
    const second: {
      resolve:
        | ((value: Awaited<ReturnType<typeof previewSubmissionDigest>>) => void)
        | null
    } = { resolve: null }
    vi.mocked(previewSubmissionDigest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          second.resolve = resolve
        }),
    )

    // A live block edit lands after the check: payload change + version.
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

    // The dialog must not stay "checked" against the old content: the preview
    // is cleared, the checklist drops back to checking and Submit disables
    // until the new check lands.
    expect(screen.queryByRole('group', { name: 'Evidence preview' })).toBeNull()
    expect(screen.getByText(/being checked again/)).toBeTruthy()
    expect(screen.getByTestId('submission-readiness').textContent).toContain(
      'Checking your notebook',
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
    await waitFor(() => expect(second.resolve).not.toBeNull())
    second.resolve!({
      recordId: 'r1',
      sourceDigest: 'def456digest',
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })
    expect(
      await screen.findByRole('group', { name: 'Evidence preview' }),
    ).toBeTruthy()
    expect(vi.mocked(previewSubmissionDigest)).toHaveBeenCalledTimes(2)
  })

  it('checks the notebook again when record details change after it was checked', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
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
    const { rerender } = render(ui(testRecord))
    await waitFor(() =>
      expect(vi.mocked(previewSubmissionDigest)).toHaveBeenCalledTimes(1),
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
        'disabled',
        false,
      ),
    )

    // Title edit bumps metadata: the checked result no longer applies.
    rerender(ui({ ...testRecord, title: 'Renamed assay', metadataVersion: 2 }))

    await waitFor(() =>
      expect(vi.mocked(previewSubmissionDigest)).toHaveBeenCalledTimes(2),
    )
  })

  it('discards the check when the notebook changes while it is still running', async () => {
    const { previewSubmissionDigest } = await import('#/lib/notebook-data')
    // Hold the first check pending until the test releases it, simulating a
    // slow response while the notebook is edited.
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
    const { rerender } = render(ui([block]))
    await waitFor(() => expect(deferred.resolve).not.toBeNull())
    const firstResolve = deferred.resolve!

    // The notebook changes while the first check is still pending.
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
    firstResolve({
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 1,
    })

    // The stale response must NOT enable the preview or Submit; the notebook
    // is checked again instead.
    await waitFor(() => {
      expect(vi.mocked(previewSubmissionDigest)).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole('group', { name: 'Evidence preview' })).toBeNull()
    expect(screen.getByTestId('submission-readiness').textContent).toContain(
      'Checking your notebook',
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })
})
