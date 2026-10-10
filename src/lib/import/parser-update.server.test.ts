import { beforeEach, expect, it, vi } from 'vitest'
import { handleParserUpdateRequest } from './parser-update.server'

const { rpc, resolve } = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn() }))
vi.mock('#/lib/request-auth', () => ({
  postgrestRpc: rpc,
  resolveSessionAuth: resolve,
  realSessionAuthDeps: {},
  requestErrorResponse: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
}))
const FILE = '00000000-0000-4000-8000-000000000456'
function request(extra = {}) {
  return new Request('http://app.invalid/api/parsers/request-update', {
    method: 'POST',
    body: JSON.stringify({ fileId: FILE, ...extra }),
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  resolve.mockResolvedValue({ ok: true, context: { token: 'scoped-token' } })
})
it('does not accept client-selected recipients, failure state or resolution', async () => {
  for (const extra of [
    { recipientUserId: 'other' },
    { parser_failure: {} },
    { resolved: true },
  ]) {
    expect((await handleParserUpdateRequest(request(extra))).status).toBe(400)
  }
  expect(rpc).not.toHaveBeenCalled()
})
it('passes only retained identity through the claims-bound authority and requires confirmation', async () => {
  rpc.mockResolvedValue({
    status: 200,
    body: { id: FILE, parser_failure: { requestedAt: '2026-10-04T10:00:00Z' } },
  })
  expect(await (await handleParserUpdateRequest(request())).json()).toEqual({
    ok: true,
    fileId: FILE,
  })
  expect(rpc).toHaveBeenCalledWith(
    'request_parser_update',
    { p_file_id: FILE },
    'scoped-token',
  )
  rpc.mockResolvedValue({
    status: 200,
    body: { id: FILE, parser_failure: null },
  })
  expect((await handleParserUpdateRequest(request())).status).toBe(502)
})
it('does not report request success for a missing or denied SQL operation', async () => {
  for (const status of [404, 403]) {
    rpc.mockResolvedValue({ status, body: { message: 'Unavailable' } })
    expect((await handleParserUpdateRequest(request())).status).toBe(status)
  }
})
