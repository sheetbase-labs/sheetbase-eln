import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDataClient } from '#/lib/data-client'
import { sheetInstanceFromWire } from '#/lib/sheet-instance-data'
import type { ComposedSheetSnapshot } from '#/lib/sheet-composition-data'
import { validSheetDefinitionConfiguration } from '../../../tests/fixtures/sheet-definition'
import { useCanonicalWorkspaceCalculations } from './canonical-workspace-calculations'

const INSTANCE = '21000000-0000-4000-8000-000000000001'
const DATASET = '21000000-0000-4000-8000-000000000002'
const definitionConfiguration = validSheetDefinitionConfiguration()

const instance = sheetInstanceFromWire({
  id: INSTANCE,
  workspace_id: DATASET,
  project_id: null,
  notebook_record_id: null,
  source_definition_version_id: DATASET,
  name: 'Calculation windows',
  description: null,
  lifecycle: 'active',
  revision: 7,
  state: {
    bindings: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
      filters: [],
      sorts: [],
    },
    provenance: { createdFrom: 'definition_version' },
  },
  duplicated_from_instance_id: null,
  created_at: '2026-08-16T12:00:00Z',
  updated_at: '2026-08-16T12:00:00Z',
  created_by_user_id: 'u1',
  updated_by_user_id: 'u1',
})

const rowIds = [
  '22000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000002',
  '22000000-0000-4000-8000-000000000003',
]

const composedSnapshot: ComposedSheetSnapshot = {
  instanceId: INSTANCE,
  definitionVersionId: DATASET,
  definitionConfiguration,
  revision: 7,
  offset: 0,
  limit: 200,
  hasMore: false,
  localFieldIds: [],
  identity: {
    kind: 'source',
    columnIds: [definitionConfiguration.columns[0].id],
    logicalTypes: ['reference'],
  },
  rows: rowIds.map((rowId, index) => ({
    rowKey: rowId,
    compositionOffset: index * 200,
    identityValues: [rowId],
    sources: [
      {
        sourceKind: 'dataset',
        bindingId: definitionConfiguration.bindings[0].id,
        datasetId: DATASET,
        datasetRevision: 1,
        rowId,
        revision: 1,
        matched: true,
        values: {},
      },
    ],
  })),
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('canonical calculation windows', () => {
  it.each([false, true])(
    'commits windows in order, stops on refusal and reads only after completion (refuse=%s)',
    async (refuse) => {
      const postedOffsets: number[] = []
      const completions: Array<(response: Response) => void> = []
      let reads = 0

      const transport: typeof fetch = async (input, init) => {
        if (input === '/api/sheet-calculations') {
          const body = z
            .object({
              instanceId: z.literal(INSTANCE),
              expectedRevision: z.literal(7),
              offset: z.number(),
              limit: z.literal(200),
              retryToken: z.uuid(),
            })
            .parse(JSON.parse(z.string().parse(init?.body)))

          postedOffsets.push(body.offset)

          return new Promise<Response>((resolve) => completions.push(resolve))
        }

        reads += 1

        return Response.json({ instanceId: INSTANCE, revision: 7, results: [] })
      }

      vi.stubGlobal('fetch', transport)

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      })

      const { result } = renderHook(
        () =>
          useCanonicalWorkspaceCalculations({
            instance,
            composedSnapshot,
            canWrite: true,
            client: createDataClient(transport),
          }),
        {
          wrapper: ({ children }) => (
            <QueryClientProvider client={queryClient}>
              {children}
            </QueryClientProvider>
          ),
        },
      )

      const completed = () =>
        Response.json({
          instanceId: INSTANCE,
          revision: 7,
          rowCount: 1,
          calculationCount: 1,
          status: 'completed',
        })

      await waitFor(() => expect(postedOffsets).toEqual([0]))
      expect(reads).toBe(0)
      await act(async () => completions[0](completed()))
      await waitFor(() => expect(postedOffsets).toEqual([0, 200]))
      expect(reads).toBe(0)

      await act(async () =>
        completions[1](
          refuse
            ? Response.json(
                { error: { code: 'stale_revision', message: 'Sheet changed' } },
                { status: 409 },
              )
            : completed(),
        ),
      )

      if (refuse) {
        await waitFor(() => expect(result.current.isError).toBe(true))
        expect(result.current.error).toMatchObject({ code: 'stale_revision' })
        expect(postedOffsets).toEqual([0, 200])
        expect(reads).toBe(0)
      } else {
        await waitFor(() => expect(postedOffsets).toEqual([0, 200, 400]))
        expect(reads).toBe(0)
        await act(async () => completions[2](completed()))
        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(reads).toBe(1)
        expect(result.current.data).toEqual({ mapped: {}, rows: [] })
      }

      queryClient.clear()
    },
  )
})
