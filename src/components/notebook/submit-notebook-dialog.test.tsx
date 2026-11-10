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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type {
  NotebookRecord,
  SubmissionDigestPreview,
} from '#/lib/notebook-data'
import type { WorkspaceMember } from '#/lib/workspace-admin'
import { dropSharedReads } from '#/lib/data-client'
import { SubmitNotebookDialog } from './submit-notebook-dialog'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

const names = { byId: {} }
let members: WorkspaceMember[] = []
let allowedReviewers: string[] | undefined
let digest: SubmissionDigestPreview
let digestResponse: (() => Promise<Response>) | undefined
let certificationsUnavailable = true
let stepUpDenied = false
let revisionId = 'rev-1'

function requestsTo(path: string) {
  return transport.mock.calls.filter(
    ([input]) =>
      new URL(input instanceof Request ? input.url : input, 'http://localhost')
        .pathname === path,
  )
}

function pendingResponse() {
  let complete: (response: Response) => void

  const promise = new Promise<Response>((resolve) => {
    complete = resolve
  })

  return { promise, resolve: (response: Response) => complete(response) }
}

beforeEach(() => {
  dropSharedReads()
  names.byId = {}
  members = []
  allowedReviewers = undefined
  digest = {
    recordId: 'r1',
    sourceDigest: 'abc123digest',
    structureVersion: 1,
    metadataVersion: 1,
    calculationInputRevision: 1,
  }
  digestResponse = undefined
  certificationsUnavailable = true
  stepUpDenied = false
  revisionId = 'rev-1'
  transport.mockReset()
  transport.mockImplementation(async (input) => {
    const path = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    ).pathname

    switch (path) {
      case '/api/db/rpc/available_review_workflows':
        return Response.json([
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
        ])
      case '/api/db/rpc/preview_submission_digest':
        return digestResponse ? digestResponse() : Response.json(digest)
      case '/api/db/rpc/submit_record_revision':
        return Response.json({
          revision: { id: revisionId, integrityDigest: digest.sourceDigest },
          submission: { id: 'sub-1', state: 'submitted' },
          idempotent: false,
        })
      case '/api/db/rpc/run_revision_checks':
        return Response.json({})
      case '/api/db/workspace_memberships':
        return Response.json(
          members.map((member) => ({
            id: member.id,
            workspace_id: member.workspaceId,
            user_id: member.userId,
            role: member.role,
            suspended_at: member.suspendedAt,
            created_at: member.createdAt,
            updated_at: member.updatedAt,
          })),
        )
      case '/api/db/rpc/project_review_candidates':
        return Response.json(
          (allowedReviewers ?? ['u1', ...members.map((m) => m.userId)]).map(
            (user_id) => ({
              user_id,
            }),
          ),
        )
      case '/api/db/rpc/workspace_signature_certifications':
        if (certificationsUnavailable)
          throw new Error('certification read unavailable')

        return Response.json([])
      case '/api/signatures/step-up':
        return stepUpDenied
          ? Response.json(
              { message: 'Signing is locked for 15 minutes.' },
              { status: 423 },
            )
          : Response.json({
              token: 'bound-password-token',
              expiresAt: '2026-10-04T12:05:00Z',
              authMethod: 'password',
            })
      case '/api/db/records':
      case '/api/db/projects':
      case '/api/db/member_absences':
      case '/api/db/workspace_settings':
        return Response.json([])
      default:
        throw new Error(`Unexpected request: ${path}`)
    }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  names.byId = {}
})

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(<DialogProviders client={client}>{ui}</DialogProviders>)
}

function DialogProviders({
  client,
  children,
}: {
  client: QueryClient
  children: ReactNode
}) {
  for (const id of Object.keys(names.byId)) {
    client.setQueryData(['user-names', [id]], names.byId)
  }

  client.setQueryDefaults(['user-names'], { staleTime: Infinity })

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return (
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>{children}</RouterContextProvider>
    </QueryClientProvider>
  )
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
    allowedReviewers = ['u1']
    members = [
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
    ]
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
  })

  it('refuses a reviewer who cannot open a draft experiment', async () => {
    names.byId = { '22222222-reviewer': 'Mei L.', u1: 'Gareth P.' }
    digest = {
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 1,
      metadataVersion: 1,
      calculationInputRevision: 1,
    }
    members = [
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
    ]
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

    digest = {
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 1,
      metadataVersion: 1,
      calculationInputRevision: 1,
    }
    members = [
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
    ]
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
    await waitFor(() =>
      expect(requestsTo('/api/db/rpc/submit_record_revision')).toHaveLength(1),
    )
    expect(
      z
        .object({
          p_reviewer_user_ids: z.array(z.string()),
          p_due_at: z.string(),
        })
        .parse(
          JSON.parse(
            z
              .string()
              .parse(
                requestsTo('/api/db/rpc/submit_record_revision')[0][1]?.body,
              ),
          ),
        ),
    ).toEqual({
      p_reviewer_user_ids: ['22222222-reviewer'],
      p_due_at: new Date('2026-10-15T00:00:00').toISOString(),
    })
    expect(requestsTo('/api/signatures/step-up')).toHaveLength(0)
    // The review opens with its checks already run.
    await waitFor(() =>
      expect(requestsTo('/api/db/rpc/run_revision_checks')).toHaveLength(1),
    )
    expect(
      JSON.parse(
        z
          .string()
          .parse(requestsTo('/api/db/rpc/run_revision_checks')[0][1]?.body),
      ),
    ).toMatchObject({ p_revision_id: 'rev-1' })
  })

  it('names every reviewer candidate instead of the shared uuid prefix', async () => {
    names.byId = {
      '00000000-0000-4000-8000-000000000310': 'Gareth P.',
      '00000000-0000-4000-8000-000000000311': 'Priya S.',
    }
    members = [
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
    ]
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
    members = [
      {
        id: 'm1',
        workspaceId: 'ws',
        userId: 'u1',
        role: 'owner',
        suspendedAt: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ]
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
    expect(await screen.findByText('You (Owner)')).toBeTruthy()
  })

  it('binds Authored password proof to the exact controlled submission arguments', async () => {
    digest = {
      recordId: 'r1',
      sourceDigest: 'a'.repeat(64),
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 7,
    }
    revisionId = 'rev-controlled'
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
    await waitFor(() =>
      expect(requestsTo('/api/db/rpc/submit_record_revision')).toHaveLength(1),
    )
    const dueAt = new Date('2026-10-15T00:00:00').toISOString()

    const proofBody: unknown = JSON.parse(
      z.string().parse(requestsTo('/api/signatures/step-up')[0][1]?.body),
    )

    expect(proofBody).toEqual({
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
    const issued = z.object({ idempotencyKey: z.string() }).parse(proofBody)
    expect(
      JSON.parse(
        z
          .string()
          .parse(requestsTo('/api/db/rpc/submit_record_revision')[0][1]?.body),
      ),
    ).toEqual({
      p_record_id: 'r1',
      p_expected_source_digest: 'a'.repeat(64),
      p_workflow_definition_key: 'controlled-scientific-review',
      p_workflow_definition_version: 1,
      p_reviewer_user_ids: ['u1'],
      p_confirmed: true,
      p_idempotency_key: issued.idempotencyKey,
      p_due_at: dueAt,
      p_author_signing_token: 'bound-password-token',
      p_author_confirmation_phrase: 'Actual Author',
    })
    expect(screen.getByLabelText('Author signing password')).toHaveProperty(
      'value',
      '',
    )
  })

  it('says up front that an uncertified author cannot sign, and links to settings', async () => {
    certificationsUnavailable = false
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
    ).toBe('/settings/account/signature?returnTo=%2F%3Freopen%3Dsubmit')
    expect(
      screen.getByLabelText('Author signing password').matches(':disabled'),
    ).toBe(true)
  })

  it('never freezes an unsigned controlled submission after password proof fails', async () => {
    digest = {
      recordId: 'r1',
      sourceDigest: 'b'.repeat(64),
      structureVersion: 3,
      metadataVersion: 1,
      calculationInputRevision: 7,
    }
    stepUpDenied = true
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
    expect(requestsTo('/api/db/rpc/submit_record_revision')).toHaveLength(0)
    expect(screen.getByLabelText('Author signing password')).toHaveProperty(
      'value',
      '',
    )
    // A refusal sends the notebook back through its check, so the person can
    // try again without hunting for a button.
    await waitFor(() =>
      expect(requestsTo('/api/db/rpc/preview_submission_digest')).toHaveLength(
        2,
      ),
    )
  })

  it('fails the readiness checklist and blocks submit while drafts are unsaved', async () => {
    digest = {
      recordId: 'r1',
      sourceDigest: 'abc123digest',
      structureVersion: 2,
      metadataVersion: 1,
      calculationInputRevision: 7,
    }
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
    expect(requestsTo('/api/db/rpc/preview_submission_digest')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('previews what will be sent, labelled as a preview not evidence', async () => {
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
    ).toBe('/sheets/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee?projectId=p1')
  })

  it('checks the notebook again when a block changes after it was checked', async () => {
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
      <DialogProviders client={client}>
        <SubmitNotebookDialog
          open
          onOpenChange={vi.fn()}
          recordId="r1"
          projectId="p1"
          reviewerUserId="u1"
          record={testRecord}
          blocks={currentBlocks}
        />
      </DialogProviders>
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
    const second = pendingResponse()
    digestResponse = () => second.promise

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
    await waitFor(() =>
      expect(requestsTo('/api/db/rpc/preview_submission_digest')).toHaveLength(
        2,
      ),
    )
    second.resolve(
      Response.json({
        recordId: 'r1',
        sourceDigest: 'def456digest',
        structureVersion: 3,
        metadataVersion: 1,
        calculationInputRevision: 1,
      }),
    )
    expect(
      await screen.findByRole('group', { name: 'Evidence preview' }),
    ).toBeTruthy()
    expect(requestsTo('/api/db/rpc/preview_submission_digest')).toHaveLength(2)
  })

  it('checks the notebook again when record details change after it was checked', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const ui = (currentRecord: NotebookRecord) => (
      <DialogProviders client={client}>
        <SubmitNotebookDialog
          open
          onOpenChange={vi.fn()}
          recordId="r1"
          projectId="p1"
          reviewerUserId="u1"
          record={currentRecord}
        />
      </DialogProviders>
    )

    const { rerender } = render(ui(testRecord))
    await waitFor(() =>
      expect(requestsTo('/api/db/rpc/preview_submission_digest')).toHaveLength(
        1,
      ),
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
      expect(requestsTo('/api/db/rpc/preview_submission_digest')).toHaveLength(
        2,
      ),
    )
  })

  it('discards the check when the notebook changes while it is still running', async () => {
    // Hold the first check pending until the test releases it, simulating a
    // slow response while the notebook is edited.
    const deferred = pendingResponse()
    const second = pendingResponse()
    digestResponse = () => {
      digestResponse = () => second.promise

      return deferred.promise
    }

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
      <DialogProviders client={client}>
        <SubmitNotebookDialog
          open
          onOpenChange={vi.fn()}
          recordId="r1"
          projectId="p1"
          reviewerUserId="u1"
          record={testRecord}
          blocks={currentBlocks}
        />
      </DialogProviders>
    )

    const { rerender } = render(ui([block]))
    await waitFor(() =>
      expect(requestsTo('/api/db/rpc/preview_submission_digest')).toHaveLength(
        1,
      ),
    )

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
    deferred.resolve(
      Response.json({
        recordId: 'r1',
        sourceDigest: 'abc123digest',
        structureVersion: 3,
        metadataVersion: 1,
        calculationInputRevision: 1,
      }),
    )

    // The stale response must NOT enable the preview or Submit; the notebook
    // is checked again instead.
    await waitFor(() => {
      expect(requestsTo('/api/db/rpc/preview_submission_digest')).toHaveLength(
        2,
      )
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
