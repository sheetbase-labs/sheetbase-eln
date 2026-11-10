import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
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
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { LiveEventProvider } from '#/components/live/live-event-provider'
import { createDataClient, dropSharedReads } from '#/lib/data-client'
import { extensionQueryKeys } from '#/lib/extensions/client'
import { fetchBlocksForRecord, notebookQueryKeys } from '#/lib/notebook-data'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'
import type { DatasetImportRecord } from '#/lib/import/types'
import type { CurrentContext } from '#/lib/current-user'
import { NotebookCanvas } from '#/routes/records/$recordId/-notebook-page'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

afterEach(() => {
  cleanup()
  transport.mockReset()
  vi.unstubAllGlobals()
})

class ConnectedEventSource extends EventTarget {
  readyState = 1

  constructor() {
    super()
    queueMicrotask(() => {
      this.dispatchEvent(
        new MessageEvent('hello', {
          data: JSON.stringify({ workspaceId: 'workspace-1', resumeFrom: 0 }),
        }),
      )
    })
  }

  close() {}
}

const record: NotebookRecord = {
  id: '20000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000002',
  kind: 'experiment',
  identifier: 'EXP-1',
  title: 'Import evidence',
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

const fileId = '20000000-0000-4000-8000-000000000004'
const datasetId = '20000000-0000-4000-8000-000000000005'

const importBlock: NotebookBlock = {
  id: 'import-block',
  recordId: record.id,
  type: 'dataset_import',
  payload: { fileId, datasetId },
  payloadSchemaVersion: 1,
  order: 1,
  version: 1,
}

const otherBlock: NotebookBlock = {
  ...importBlock,
  id: 'other-block',
  type: 'callout',
  payload: { text: 'Methods', tone: 'info' },
  order: 2,
}

const receipt: DatasetImportRecord = {
  id: '20000000-0000-4000-8000-000000000006',
  dataset_id: datasetId,
  experiment_record_id: record.id,
  mapping: { sheetName: 'Plate', sources: [] },
  parser_id: null,
  parser_version_id: null,
  file_id: fileId,
  connector_run_id: null,
  imported_row_ids: ['observation-1'],
  parser_provenance: {},
  source_provenance: { filename: 'retained-assay.csv' },
  outcome: {},
  snapshot_version_id: '20000000-0000-4000-8000-000000000007',
  status: 'committed',
  error_detail: null,
  created_at: '2026-11-10T00:00:00Z',
}

const pinnedPayload = {
  ...importBlock.payload,
  importId: receipt.id,
  datasetVersionId: receipt.snapshot_version_id,
  sheetName: 'Plate',
}

const auth: CurrentContext = {
  user: { id: 'user-1', name: 'Scientist', email: 'scientist@example.test' },
  workspace: { id: 'workspace-1', slug: 'lab', name: 'Lab', role: 'member' },
  workspaces: [],
  timeZone: 'UTC',
  collaborationEnabled: false,
}

function blockWire(block: NotebookBlock) {
  return {
    id: block.id,
    record_id: block.recordId,
    type: block.type,
    payload: block.payload,
    payload_schema_version: block.payloadSchemaVersion,
    order: block.order,
    version: block.version,
  }
}

it.each(['success', 'refusal', 'conflict'])(
  'keeps an unselected import draft guarded through pending save and %s',
  async (outcome) => {
    dropSharedReads()
    const user = userEvent.setup()
    Element.prototype.scrollIntoView = () => {}

    document.elementFromPoint = () => null
    const saves: NotebookBlock['payload'][] = []
    const onUnsavedWorkChange = vi.fn()
    let canonicalBlock = importBlock

    let finishSave: (response: Response) => void = () => {
      throw new Error('Save has not started')
    }

    const pending = new Promise<Response>((resolve) => {
      finishSave = resolve
    })

    transport.mockImplementation(async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      if (url.pathname === '/api/db/rpc/dataset_import_list')
        return Response.json([receipt])

      if (url.pathname === '/api/db/datasets') return Response.json([])

      if (url.pathname === '/api/import/files')
        return Response.json({
          ok: true,
          fileId,
          filename: 'retained-assay.csv',
          mediaType: 'text/csv',
          byteSize: 20,
          checksum: 'a'.repeat(64),
          format: 'csv',
          datasetId,
          parsed: false,
          parser: null,
          sheet: null,
        })

      if (url.pathname === '/api/db/rpc/update_block_payload') {
        const body = z
          .object({ p_payload: z.record(z.string(), z.unknown()) })
          .parse(JSON.parse(z.string().parse(init?.body)))

        saves.push(body.p_payload)

        if (saves.length === 1) return pending
        canonicalBlock = { ...importBlock, payload: body.p_payload, version: 2 }

        return Response.json(blockWire(canonicalBlock))
      }

      if (url.pathname === '/api/db/blocks')
        return Response.json([canonicalBlock, otherBlock].map(blockWire))
      throw new Error(`Unexpected import request: ${url.pathname}`)
    })
    vi.stubGlobal('fetch', transport)
    vi.stubGlobal('EventSource', ConnectedEventSource)
    const data = createDataClient(transport)

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })

    client.setQueryData(notebookQueryKeys.record(record.id), record)
    client.setQueryData([...extensionQueryKeys.extensions, 'points'], [])

    function Notebook() {
      const blocks = useQuery({
        queryKey: notebookQueryKeys.blocks(record.id),
        queryFn: () => fetchBlocksForRecord(data, record.id),
        initialData: [importBlock, otherBlock],
      })

      return (
        <NotebookCanvas
          record={record}
          blocks={blocks.data}
          isLoading={false}
          error={null}
          onRetry={() => {}}
          client={data}
          queryClient={client}
          onUnsavedWorkChange={onUnsavedWorkChange}
        />
      )
    }

    const routeTree = createRootRoute({
      beforeLoad: () => ({ auth }),
      component: Notebook,
    })

    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })

    await router.load()

    const { container } = render(
      <QueryClientProvider client={client}>
        <LiveEventProvider>
          <RouterProvider router={router} />
        </LiveEventProvider>
      </QueryClientProvider>,
    )

    const imported = container.querySelector('#block-import-block')
    const other = container.querySelector('#block-other-block')

    if (!(imported instanceof HTMLElement) || !(other instanceof HTMLElement))
      throw new Error('Notebook blocks did not mount')
    await user.click(imported)
    await waitFor(() =>
      expect(imported.textContent).toContain('retained-assay.csv'),
    )
    await waitFor(() =>
      expect(
        window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
      ).toBe(false),
    )
    expect(onUnsavedWorkChange).toHaveBeenLastCalledWith(true)
    await user.click(other)
    await waitFor(() => expect(saves).toEqual([pinnedPayload]))
    expect(other.getAttribute('data-selected')).toBe('true')
    expect(within(imported).getByText('retained-assay.csv')).toBeTruthy()
    expect(
      window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
    ).toBe(false)
    expect(onUnsavedWorkChange).toHaveBeenLastCalledWith(true)

    await act(async () => {
      if (outcome === 'success') {
        canonicalBlock = { ...importBlock, payload: pinnedPayload, version: 2 }
        finishSave(Response.json(blockWire(canonicalBlock)))
      } else {
        if (outcome === 'conflict')
          canonicalBlock = {
            ...importBlock,
            payload: pinnedPayload,
            version: 2,
          }
        finishSave(
          Response.json(
            {
              code:
                outcome === 'conflict' ? 'stale_version' : 'validation_error',
              message: 'Import note refused',
            },
            { status: outcome === 'conflict' ? 409 : 403 },
          ),
        )
      }
    })

    if (outcome === 'conflict') {
      const useServer = await within(imported).findByRole('button', {
        name: /Use their version/,
      })

      expect(
        window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
      ).toBe(false)
      expect(onUnsavedWorkChange).toHaveBeenLastCalledWith(true)
      fireEvent.click(useServer)
    } else if (outcome === 'refusal') {
      const retry = await within(imported).findByRole('button', {
        name: 'Try again',
      })

      expect(
        window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
      ).toBe(false)
      expect(onUnsavedWorkChange).toHaveBeenLastCalledWith(true)
      fireEvent.click(retry)
      await waitFor(() => expect(saves).toEqual([pinnedPayload, pinnedPayload]))
    }

    await waitFor(() =>
      expect(
        window.dispatchEvent(new Event('beforeunload', { cancelable: true })),
      ).toBe(true),
    )
    expect(onUnsavedWorkChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByText('retained-assay.csv')).toBeTruthy()
    expect(saves).toHaveLength(outcome === 'refusal' ? 2 : 1)
  },
)
