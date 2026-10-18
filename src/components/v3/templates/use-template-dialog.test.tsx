/**
 * J-NBK-01: "Use template" starts a notebook through
 * instantiate_notebook_template_version and opens it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UseTemplateDialog } from './use-template-dialog'
import { notebookTemplateVersionFromWire } from '#/lib/notebook-template-data'

const PROJECT = '00000000-0000-4000-8000-0000000000a1'
const READ_ONLY = '00000000-0000-4000-8000-0000000000a2'
const VERSION = '00000000-0000-4000-8000-000000000001'

const nav = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => nav,
}))
vi.mock('#/components/v3/ui/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

const client = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('#/lib/notebook-template-data', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    notebookTemplateDataClient: client,
    // The real helper binds its own module's client, so answer the RPC here
    // with the argument names it sends.
    instantiateNotebookTemplateVersion: (input: {
      versionId: string
      targetProjectId: string
      title?: string
      idempotencyKey: string
    }) =>
      client.rpc('instantiate_notebook_template_version', {
        p_version_id: input.versionId,
        p_target_project_id: input.targetProjectId,
        p_title: input.title ?? null,
        p_idempotency_key: input.idempotencyKey,
      }),
  }
})

const perm = {
  can_edit: true,
  can_review: false,
  can_manage: false,
  can_view: true,
  client_portal: false,
}

function version() {
  return notebookTemplateVersionFromWire({
    id: VERSION,
    template_id: '00000000-0000-4000-8000-000000000009',
    version: 2,
    lifecycle: 'published',
    configuration_format_version: 1,
    configuration: { formatVersion: 1, parameters: [], placements: [] },
    revision: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_user_id: null,
    updated_by_user_id: null,
    published_at: '2026-01-02T00:00:00.000Z',
    published_by_user_id: null,
    reason: null,
    signed_by_user_id: null,
    signed_meaning: null,
    signed_at: null,
    retired_at: null,
    retired_by_user_id: null,
  })
}

function renderDialog(v: ReturnType<typeof version> | null) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UseTemplateDialog templateName="Depth filter" version={v} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UseTemplateDialog', () => {
  it('is disabled with a reason when nothing is published', () => {
    renderDialog(null)
    const button = screen.getByRole('button', { name: 'Use template' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('title')).toMatch(/Publish a version first/)
  })

  it('instantiates the published version in an editable project and opens it', async () => {
    client.list.mockImplementation(async (resource: string) =>
      resource === 'projects'
        ? [
            {
              id: READ_ONLY,
              title: 'Aardvark (view only)',
              archived_at: null,
              status: 'active',
            },
            {
              id: PROJECT,
              title: 'Bravo',
              archived_at: null,
              status: 'active',
            },
          ]
        : [],
    )
    client.rpc.mockImplementation(async (name: string) => {
      if (name === 'my_project_permissions')
        return [
          { project_id: PROJECT, access_level: 'editor', ...perm },
          {
            project_id: READ_ONLY,
            access_level: 'viewer',
            ...perm,
            can_edit: false,
          },
        ]
      return {
        record: { id: 'rec-1', project_id: PROJECT, identifier: 'EXP-9' },
        templateVersionId: VERSION,
        composition: [],
        idempotent: false,
      }
    })
    renderDialog(version())
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    await screen.findByRole('option', { name: 'Bravo' })
    expect(screen.queryByRole('option', { name: /Aardvark/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start notebook' }))
    await waitFor(() =>
      expect(nav).toHaveBeenCalledWith({
        to: '/experiments/$expId/notebook',
        params: { expId: 'rec-1' },
      }),
    )
    const call = client.rpc.mock.calls.find(
      ([name]) => name === 'instantiate_notebook_template_version',
    )
    expect(call?.[1]).toMatchObject({
      p_version_id: VERSION,
      p_target_project_id: PROJECT,
      p_title: null,
    })
    expect(typeof call?.[1].p_idempotency_key).toBe('string')
  })
})
