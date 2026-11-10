import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createDataClient, dropSharedReads } from '#/lib/data-client'
import { sheetInstanceStateSchema } from '#/lib/sheet-instance'
import { notebookQueryKeys } from '#/lib/notebook-data'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import { extensionQueryKeys } from '#/lib/extensions/client'
import { NotebookCanvas } from './-notebook-page'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

const recordId = '20000000-0000-4000-8000-000000000001'
const projectId = '20000000-0000-4000-8000-000000000002'
const workspaceId = '20000000-0000-4000-8000-000000000003'
const instanceId = '20000000-0000-4000-8000-000000000004'

const record: NotebookRecord = {
  id: recordId,
  projectId,
  kind: 'experiment',
  identifier: 'EXP-1',
  title: 'Worksheet evidence',
  status: 'in-progress',
  tags: [],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'user-1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

const block: NotebookBlock = {
  id: 'file-block',
  recordId,
  type: 'file',
  payload: {
    fileRecordId: 'file-1',
    fileVersion: 3,
    displayName: 'plate.xlsx',
    mediaType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    byteSize: 20_000_000,
  },
  payloadSchemaVersion: 1,
  order: 1,
  version: 1,
}

beforeEach(() => {
  dropSharedReads()
  vi.stubGlobal('fetch', transport)
  document.elementFromPoint = () => null
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  transport.mockReset()
})

it.each(['success', 'creation-refused', 'insertion-refused'])(
  'refreshes only affected sheet lists after creation: %s',
  async (outcome) => {
    const requests: string[] = []
    transport.mockImplementation(async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      if (url.pathname === '/api/db/rpc/create_sheet_instance') {
        requests.push('create')

        if (outcome === 'creation-refused')
          return Response.json(
            { code: '42501', message: 'Creation refused' },
            { status: 403 },
          )

        const body = z
          .object({ p_state: sheetInstanceStateSchema })
          .parse(JSON.parse(z.string().parse(init?.body)))

        return Response.json({
          id: instanceId,
          workspace_id: workspaceId,
          project_id: projectId,
          notebook_record_id: recordId,
          source_definition_version_id: null,
          name: 'Plate',
          description: null,
          lifecycle: 'active',
          revision: 1,
          state: body.p_state,
          duplicated_from_instance_id: null,
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
          created_by_user_id: null,
          updated_by_user_id: null,
        })
      }

      if (url.pathname === '/api/db/rpc/insert_sheet_instance_block') {
        requests.push('insert')

        if (outcome === 'insertion-refused')
          return Response.json(
            { code: '42501', message: 'Insertion refused' },
            { status: 403 },
          )

        return Response.json({
          block: {
            id: 'new-sheet-block',
            record_id: recordId,
            type: 'sheet',
            payload: { instanceId },
            payload_schema_version: 1,
            order: 2,
            version: 1,
          },
          instance: { id: instanceId },
          structure_version: 2,
        })
      }

      if (url.pathname === '/api/office-editor/status')
        return Response.json({ enabled: false, reachable: false })

      return Response.json([])
    })

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })

    const pickerKeys = [
      ['sheet-instances', 'embed-picker', recordId],
      ['sheet-instances', 'embed-picker', 'another-record'],
    ]

    const activeKey = ['ui-port', 'project-sheets', projectId, 'active']

    const unaffectedKeys = [
      ['ui-port', 'project-sheets', projectId, 'archived'],
      ['ui-port', 'project-sheets', 'another-project', 'active'],
      ['sheet-instances', 'other-list'],
    ]

    for (const key of [...pickerKeys, activeKey, ...unaffectedKeys])
      client.setQueryData(key, [])
    client.setQueryData(notebookQueryKeys.record(recordId), record)
    client.setQueryData(notebookQueryKeys.blocks(recordId), [block])
    client.setQueryData([...extensionQueryKeys.extensions, 'points'], [])
    client.setQueryData(
      ['office-workbook', 'file-1', 3],
      [{ name: 'Plate', rows: [[{ value: 'Recovery' }], [{ value: 5.75 }]] }],
    )

    const routeTree = createRootRoute({
      component: () => (
        <NotebookCanvas
          record={record}
          blocks={[block]}
          isLoading={false}
          error={null}
          onRetry={() => {}}
          client={createDataClient(transport)}
          queryClient={client}
          collaborationWorkspaceId={workspaceId}
          collaborationRole="member"
        />
      ),
    })

    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    await router.load()
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByText('plate.xlsx'))
    fireEvent.click(await screen.findByRole('button', { name: 'Make a sheet' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make sheet' }))

    await waitFor(() =>
      expect(requests).toEqual(
        outcome === 'creation-refused' ? ['create'] : ['create', 'insert'],
      ),
    )

    if (outcome === 'success')
      await waitFor(() =>
        expect(client.getQueryData(notebookQueryKeys.blocks(recordId))).toEqual(
          [
            block,
            expect.objectContaining({
              id: 'new-sheet-block',
              payload: { instanceId },
            }),
          ],
        ),
      )
    else
      expect(
        await screen.findByText(
          outcome === 'creation-refused'
            ? /Creation refused/
            : /Insertion refused/,
        ),
      ).toBeTruthy()

    for (const key of [...pickerKeys, activeKey])
      expect(client.getQueryState(key)?.isInvalidated).toBe(
        outcome !== 'creation-refused',
      )

    for (const key of unaffectedKeys)
      expect(client.getQueryState(key)?.isInvalidated).toBe(false)

    if (outcome !== 'success')
      expect(client.getQueryData(notebookQueryKeys.blocks(recordId))).toEqual([
        block,
      ])
  },
)
