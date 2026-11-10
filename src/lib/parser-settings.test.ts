import { describe, expect, it, vi } from 'vitest'
import { createDataClient, DataClientError } from './data-client'
import {
  approveParserVersion,
  createParserDraft,
  fetchParserSettings,
  parserSettingsQueryKeys,
} from './parser-settings'

/**
 * The request the data client issued, rebuilt as a real `Request` so a test can
 * read its URL and JSON body without asserting on an untyped call tuple.
 */
function issuedRequest(
  call: [RequestInfo | URL, RequestInit?] | undefined,
): Request {
  if (!call) throw new Error('The data client issued no request.')

  return new Request(
    new URL(
      call[0] instanceof Request ? call[0].url : call[0],
      'http://app.test',
    ),
    call[1],
  )
}

describe('canonical parser settings boundary', () => {
  it('reads persisted versions and linked instruments through the same-origin workspace boundary', async () => {
    const rows = [{ id: 'persisted-parser', parser_versions: [{ version: 4 }] }]

    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(rows),
    )

    expect(
      await fetchParserSettings(createDataClient(fetch), 'workspace-a'),
    ).toEqual(rows)
    const url = issuedRequest(fetch.mock.calls[0]).url
    expect(url).toContain('/api/db/parsers?workspace_id=eq.workspace-a')
    expect(url).toContain('instruments(id,name)')
    expect(url).toContain(
      'test_result,validated_at,approved_at,approved_by_user_id',
    )
    expect(url).toContain('parser_versions.order=version.desc')
    expect(parserSettingsQueryKeys.list('workspace-a')).not.toEqual(
      parserSettingsQueryKeys.list('workspace-b'),
    )
  })

  it('creates a draft via the canonical RPC without accepting approval or validation from the browser', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ status: 'draft' }),
    )

    await createParserDraft(createDataClient(fetch), {
      workspaceId: 'workspace-a',
      key: 'tb02',
      name: 'TB-02',
      format: 'csv',
      version: 4,
      instrumentId: 'instrument-b',
      signature: { requiredHeaders: ['ntu'] },
      mapping: { ntu: 'field-c' },
    })
    const request = issuedRequest(fetch.mock.calls[0])
    expect(request.url).toBe('http://app.test/api/db/rpc/create_parser_version')
    expect(await request.json()).toEqual({
      p_workspace_id: 'workspace-a',
      p_key: 'tb02',
      p_name: 'TB-02',
      p_format: 'csv',
      p_version: 4,
      p_instrument_id: 'instrument-b',
      p_signature: { requiredHeaders: ['ntu'] },
      p_mapping: { ntu: 'field-c' },
    })
  })

  it('approves the exact version through the authoritative RPC and preserves denial', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { code: '42501', message: 'not permitted to approve a parser' },
        { status: 403 },
      ),
    )

    await expect(
      approveParserVersion(createDataClient(fetch), 'version-c'),
    ).rejects.toBeInstanceOf(DataClientError)
    const request = issuedRequest(fetch.mock.calls[0])
    expect(request.url).toBe(
      'http://app.test/api/db/rpc/approve_parser_version',
    )
    expect(await request.json()).toEqual({
      p_parser_version_id: 'version-c',
    })
  })
})
