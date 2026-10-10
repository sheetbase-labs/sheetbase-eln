import { describe, expect, it, vi } from 'vitest'
import { createDataClient } from './data-client'
import {
  fetchWorkspaceGeneral,
  updateWorkspaceOfflineEditing,
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
                allow_offline_editing: true,
                id_prefixes: {},
                workspaces: { name: 'Process Development' },
              },
            ]),
            { status: 200 },
          ),
      )
      const client = createDataClient(fetcher)
      const general = await fetchWorkspaceGeneral(client)
      expect(general?.publicationApprovalRequired).toBe(required)
      expect(general?.offlineEditingAllowed).toBe(true)
      expect(fetcher.mock.calls[0]?.[0]).toContain(
        'publication_approval_required',
      )
      expect(fetcher.mock.calls[0]?.[0]).toContain('allow_offline_editing')
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

  it.each([true, false])(
    'writes the offline-editing rule %s through the editing-rules RPC',
    async (allowed) => {
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 204 }),
      )
      const client = createDataClient(fetcher)

      await updateWorkspaceOfflineEditing('ws-1', allowed, client)

      expect(fetcher.mock.calls[0]?.[0]).toBe(
        '/api/db/rpc/update_workspace_settings',
      )
      expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
        p_workspace_id: 'ws-1',
        p_allow_offline_editing: allowed,
      })
    },
  )
})
