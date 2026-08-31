import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SubmitNotebookDialog } from './submit-notebook-dialog'
import { fetchWorkspaceMembers } from '#/lib/workspace-admin'

vi.mock('#/lib/notebook-data', async (importOriginal) => ({
  ...(await importOriginal()),
  previewSubmissionDigest: vi.fn(),
  submitRecordRevision: vi.fn(),
}))

vi.mock('#/lib/workspace-admin', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceMembers: vi.fn(),
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
})

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('SubmitNotebookDialog', () => {
  it('requires a snapshot check and a reviewer before submit', async () => {
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
      />,
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(await screen.findByText('You (scientist)')).toBeTruthy()
    await user.click(screen.getByText('22222222 · reviewer'))
    await user.click(screen.getByRole('button', { name: 'Check snapshot' }))
    expect(
      await screen.findByText(/Integrity check: abc123digest/),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toHaveProperty(
      'disabled',
      false,
    )
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(submitRecordRevision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reviewerUserIds: ['u1', '22222222-reviewer'],
      }),
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
    const user = userEvent.setup()
    renderDialog(
      <SubmitNotebookDialog
        open
        onOpenChange={vi.fn()}
        recordId="r1"
        projectId="p1"
        reviewerUserId="u1"
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
})
