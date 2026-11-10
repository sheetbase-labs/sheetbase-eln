import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NotebookRecord } from '#/lib/notebook-data'
import { EMPTY_RICH_TEXT_PAYLOAD, PAYLOAD_SCHEMA_VERSION } from '#/lib/blocks'

import { DuplicateNotebookDialog } from './duplicate-notebook-dialog'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const source: NotebookRecord = {
  id: 'r1',
  projectId: 'p1',
  kind: 'experiment',
  identifier: 'EXP-2026-0001',
  title: 'Stability run',
  status: 'in-progress',
  tags: [],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

function renderDialog(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('DuplicateNotebookDialog', () => {
  it('defaults the title and duplicates the Notebook', async () => {
    const copied: NotebookRecord = {
      ...source,
      id: 'r2',
      title: 'Stability run copy',
      folderId: null,
      customFields: {},
      sourceNotebookTemplateVersionId: null,
    }

    transport.mockImplementation(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      if (url.pathname === '/api/db/rpc/create_record_link')
        return Response.json({})

      if (url.pathname !== '/api/db/rpc/create_record_with_blocks')
        throw new Error(`Unexpected request: ${url.pathname}`)

      return Response.json({
        record: {
          id: copied.id,
          workspace_id: 'ws-1',
          project_id: copied.projectId,
          folder_id: null,
          kind: copied.kind,
          identifier: copied.identifier,
          title: copied.title,
          status: copied.status,
          tags: copied.tags,
          structure_version: 1,
          metadata_version: 1,
          created_at: copied.createdAt,
          updated_at: copied.updatedAt,
          archived_at: null,
          deleted_at: null,
          created_by_user_id: 'u1',
          updated_by_user_id: null,
          properties: {},
          locked_at: null,
          locked_by_revision_id: null,
        },
        blocks: [],
      })
    })
    const onDuplicated = vi.fn()
    const user = userEvent.setup()
    renderDialog(
      <DuplicateNotebookDialog
        open
        onOpenChange={vi.fn()}
        source={source}
        blocks={[]}
        onDuplicated={onDuplicated}
      />,
    )
    expect(screen.getByLabelText('Notebook title')).toHaveProperty(
      'value',
      'Stability run copy',
    )
    await user.click(screen.getByRole('button', { name: 'Duplicate' }))
    expect(transport).toHaveBeenCalledWith(
      '/api/db/rpc/create_record_with_blocks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          p_project_id: 'p1',
          p_kind: 'experiment',
          p_title: 'Stability run copy',
          p_status: 'draft',
          p_tags: [],
          p_blocks: [
            {
              type: 'rich_text',
              payload: EMPTY_RICH_TEXT_PAYLOAD,
              payload_schema_version: PAYLOAD_SCHEMA_VERSION,
              order: 1,
            },
          ],
          p_properties: {},
        }),
      }),
    )
    await waitFor(() => expect(onDuplicated).toHaveBeenCalledWith(copied))
  })
})
