import { QueryClient } from '@tanstack/react-query'
import { createDataClient } from '#/lib/data-client'
import { toSampleRecord } from '#/lib/samples'
import type { RecordWire } from '#/lib/notebook-data'
import { fetchBoxChoices, positionKeys } from '#/lib/storage-positions'
import { fetchStorageTree, locationSuggestions } from '#/lib/storage-locations'
import { fetchStorageLocations, storageLocationsQueryKey } from './samples-data'

/** Complete domain fixtures, including the quantities omitted by the old casts. */
export function quantitySample(patch: Partial<RecordWire>) {
  return toSampleRecord({
    id: 'sample',
    workspace_id: 'workspace',
    project_id: null,
    folder_id: null,
    kind: 'sample',
    identifier: 'SMP-1',
    title: 'Sample',
    status: 'available',
    tags: [],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'user',
    updated_by_user_id: null,
    properties: {},
    custom_fields: {},
    locked_at: null,
    locked_by_revision_id: null,
    ...patch,
  })
}

/** Prefetch through the real HTTP client into the real provider, with no storage configured. */
export async function quantityTestClients() {
  const client = createDataClient(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    if (!url.pathname.startsWith('/api/db/'))
      throw new Error(`Unexpected request: ${url.pathname}`)

    return Response.json([])
  })

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  await Promise.all([
    queryClient.fetchQuery({
      queryKey: positionKeys.boxes,
      queryFn: () => fetchBoxChoices(client),
    }),
    queryClient.fetchQuery({
      queryKey: storageLocationsQueryKey,
      queryFn: () => fetchStorageLocations(client),
    }),
    queryClient.fetchQuery({
      queryKey: ['storage-locations', 'suggestions'],
      queryFn: async () =>
        locationSuggestions(
          await fetchStorageTree(client, { occupancy: false }),
        ),
    }),
  ])

  return { client, queryClient }
}
