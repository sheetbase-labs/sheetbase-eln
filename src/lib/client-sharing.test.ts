import { describe, expect, it, vi } from 'vitest'

import {
  createClientOrganisation,
  fetchClientPortalPreview,
  fetchShareableRecords,
  shareRecordWithClient,
  unsharedRecords,
  validClientName,
} from './client-sharing'
import type { DataClient } from './data-client'

function stub(overrides: Record<string, unknown>): DataClient {
  return overrides as unknown as DataClient
}

describe('validClientName', () => {
  it('trims and refuses empty or over-long names', () => {
    expect(validClientName('  Acme  ')).toBe('Acme')
    expect(validClientName('   ')).toBeNull()
    expect(validClientName('x'.repeat(201))).toBeNull()
  })
})

describe('createClientOrganisation', () => {
  it('inserts the trimmed name and lets the database assign the code', async () => {
    const insert = vi.fn(async () => [
      { id: 'c1', code: 'CL-004', name: 'Acme' },
    ])
    const created = await createClientOrganisation(stub({ insert }), {
      workspaceId: 'ws-1',
      name: ' Acme ',
    })
    expect(insert).toHaveBeenCalledWith('clients', {
      workspace_id: 'ws-1',
      name: 'Acme',
    })
    expect(created.code).toBe('CL-004')
  })

  it('refuses an empty name before any request', async () => {
    const insert = vi.fn()
    await expect(
      createClientOrganisation(stub({ insert }), {
        workspaceId: 'ws-1',
        name: ' ',
      }),
    ).rejects.toThrow(/client name/)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('sharing', () => {
  it('asks only for approved records that belong to a project', async () => {
    const list = vi.fn(async () => [])
    await fetchShareableRecords(stub({ list }), 'ws-1')
    const query = String((list.mock.calls[0] as unknown[])[1])
    expect(query).toContain('status=eq.approved')
    expect(query).toContain('project_id=not.is.null')
  })

  it('offers only records not yet shared with the client', () => {
    const records = [
      { id: 'a', identifier: 'EXP-1', title: 'A', kind: 'experiment' },
      { id: 'b', identifier: 'EXP-2', title: 'B', kind: 'experiment' },
    ]
    const shares = [
      { id: 's', clientId: 'c', recordId: 'a', sharedAt: '2026-10-19' },
    ]
    expect(unsharedRecords(records, shares).map((r) => r.id)).toEqual(['b'])
  })

  it('shares through the database function', async () => {
    const rpc = vi.fn(async () => ({}))
    await shareRecordWithClient(stub({ rpc }), {
      clientId: 'c1',
      recordId: 'r1',
    })
    expect(rpc).toHaveBeenCalledWith('share_record_with_client', {
      p_client_id: 'c1',
      p_record_id: 'r1',
    })
  })
})

describe('fetchClientPortalPreview', () => {
  it('maps the preview rows to the portal shapes', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'client_portal_preview_projects'
        ? [
            {
              project_id: 'p1',
              display_id: 'PRJ-1',
              title: 'Open book',
              stage: null,
              status: 'active',
              modality: null,
              lead_name: 'Ada',
              last_update: null,
              client_name: 'Acme',
              client_code: 'CL-001',
            },
          ]
        : [
            {
              record_id: 'r1',
              identifier: 'EXP-1',
              title: 'Run',
              kind: 'experiment',
              status: 'approved',
              project_id: 'p1',
              shared_at: '2026-10-19T09:00:00Z',
              approved_at: null,
              approved_by_name: null,
            },
          ],
    )
    const preview = await fetchClientPortalPreview(stub({ rpc }), 'c1')
    expect(preview.projects[0]?.clientCode).toBe('CL-001')
    expect(preview.records[0]?.recordId).toBe('r1')
    expect(rpc).toHaveBeenCalledWith('client_portal_preview_records', {
      p_client_id: 'c1',
    })
  })
})
