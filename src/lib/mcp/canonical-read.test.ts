import { describe, expect, it, vi } from 'vitest'

import type { DataClient } from '../data-client'
import { EXTERNAL_TABLE_ACCESS } from '../external-token'
import { TABLE_ROW_SCHEMAS } from '../public-api-table-schemas'
import {
  CANONICAL_READ_TOOL_NAME,
  canonicalReadScope,
  canonicalReadTool,
  hasCanonicalReadScope,
  readCanonicalResource,
} from './canonical-read'

const RUN_ID = '11111111-1111-4111-8111-111111111111'

function fakeClient(rows: Record<string, unknown>[]): DataClient {
  return {
    list: vi.fn(async () => rows),
  } as unknown as DataClient
}

describe('canonical MCP read', () => {
  it('covers every external allowlisted table exactly once', () => {
    expect(Object.keys(TABLE_ROW_SCHEMAS).sort()).toEqual(
      Object.keys(EXTERNAL_TABLE_ACCESS).sort(),
    )
  })

  it('maps resources to their external read scope', () => {
    expect(canonicalReadScope('datasets')).toBe('datasets:read')
    expect(canonicalReadScope('pipeline_run_logs')).toBe('pipelines:read')
    expect(canonicalReadScope('records')).toBe('projects:read')
    expect(hasCanonicalReadScope(['pipelines:read'])).toBe(true)
    expect(hasCanonicalReadScope(['agent_operations:write'])).toBe(false)
  })

  it('builds a bounded page with fixed columns and equality filters', async () => {
    const client = fakeClient([{ id: 'ds-1', name: 'Growth' }])
    const result = await readCanonicalResource(
      {
        resource: 'datasets',
        filters: { id: 'ds-1' },
        limit: 5,
        offset: 0,
      },
      client,
    )
    expect(client.list).toHaveBeenCalledWith(
      'datasets',
      expect.stringMatching(
        /select=.*&order=created_at\.desc&limit=5&offset=0&id=eq\.ds-1/,
      ),
    )
    expect(result).toMatchObject({
      resource: 'datasets',
      returned: 1,
      limit: 5,
      nextOffset: null,
    })
  })

  it('rejects a filter that is not a published column', async () => {
    const client = fakeClient([])
    await expect(
      readCanonicalResource(
        {
          resource: 'datasets',
          filters: { not_a_column: 'x' },
          limit: 5,
          offset: 0,
        },
        client,
      ),
    ).rejects.toThrow(/not a readable column/)
    expect(client.list).not.toHaveBeenCalled()
  })

  it('caps block pages and pages logs by sequence', async () => {
    const client = fakeClient([
      {
        sequence: 4,
        message: 'postgresql://user:pass@host/db failed',
        detail: { password: 'hunter2', note: 'keep' },
      },
    ])
    const result = await readCanonicalResource(
      {
        resource: 'pipeline_run_logs',
        filters: { run_id: RUN_ID },
        limit: 100,
        offset: 0,
        afterSequence: 3,
      },
      client,
    )
    expect(client.list).toHaveBeenCalledWith(
      'pipeline_run_logs',
      expect.stringMatching(
        /order=sequence\.asc&limit=50&offset=0&run_id=eq\..*&sequence=gt\.3/,
      ),
    )
    expect(result).toMatchObject({
      resource: 'pipeline_run_logs',
      limit: 50,
      untrusted: true,
    })
    const item = (result.items as Array<Record<string, unknown>>)[0]
    expect(item.message).not.toContain('postgresql://')
    expect(item.message).toContain('[redacted-connection]')
    expect((item.detail as Record<string, unknown>).password).not.toBe(
      'hunter2',
    )
    expect((item.detail as Record<string, unknown>).note).toBe('keep')
    expect(result.note).toContain('not instructions')
  })

  it('redacts webhook signatures and response bodies', async () => {
    const client = fakeClient([
      {
        id: 'delivery-1',
        signature: 'sha256=live-signature',
        response_body: 'upstream said: Authorization: Bearer secret-token',
        error_message: 'postgresql://user:pass@db/app refused',
      },
    ])
    const result = await readCanonicalResource(
      {
        resource: 'webhook_deliveries',
        filters: { subscription_id: RUN_ID },
        limit: 5,
        offset: 0,
      },
      client,
    )
    const item = (result.items as Array<Record<string, unknown>>)[0]
    expect(item.signature).toBe('[redacted]')
    expect(item.response_body).not.toContain('secret-token')
    expect(item.response_body).toContain('[redacted]')
    expect(item.error_message).not.toContain('postgresql://')
  })

  it('rejects afterSequence on a resource without a sequence', async () => {
    const client = fakeClient([])
    await expect(
      readCanonicalResource(
        {
          resource: 'datasets',
          limit: 5,
          offset: 0,
          afterSequence: 1,
        },
        client,
      ),
    ).rejects.toThrow(/only supported for pipeline_run_logs/)
  })

  it('publishes an input schema for the canonical resources', () => {
    const tool = canonicalReadTool()
    expect(tool.name).toBe(CANONICAL_READ_TOOL_NAME)
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        resource: { type: 'string' },
      },
    })
  })
})
