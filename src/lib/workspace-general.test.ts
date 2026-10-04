import { describe, expect, it, vi } from 'vitest'
import { createDataClient } from './data-client'
import {
  fetchWorkspaceGeneral,
  updateWorkspacePublicationPolicy,
} from './workspace-general'

describe('workspace publication policy data boundary', () => {
  it.each([true, false])(
    'reads and writes policy %s through the canonical API',
    async (required) => {
      const fetcher = vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify([
              {
                site: 'Cambridge',
                timezone: 'Europe/London',
                date_format: 'd MMM yyyy',
                number_format: 'decimal',
                publication_approval_required: required,
                id_prefixes: {},
                workspaces: { name: 'Process Development' },
              },
            ]),
            { status: 200 },
          ),
      )
      const client = createDataClient(fetcher)
      expect(
        (await fetchWorkspaceGeneral(client))?.publicationApprovalRequired,
      ).toBe(required)
      expect(fetcher.mock.calls[0]?.[0]).toContain(
        'publication_approval_required',
      )
      await updateWorkspacePublicationPolicy('ws-1', required, client)
      expect(fetcher.mock.calls[1]?.[0]).toBe(
        '/api/db/rpc/update_workspace_publication_policy',
      )
      expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
        p_workspace_id: 'ws-1',
        p_required: required,
      })
    },
  )
})
