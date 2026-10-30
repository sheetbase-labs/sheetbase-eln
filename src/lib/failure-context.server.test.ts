import { describe, expect, it, vi } from 'vitest'

import * as requestLog from './request-log'
import { annotateFailure, annotateSummary } from './failure-context.server'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('annotateFailure', () => {
  it('records the code and message of a failed JSON reply', async () => {
    const spy = vi
      .spyOn(requestLog, 'annotateRequest')
      .mockImplementation(() => undefined)
    const response = json(401, {
      error: { code: 'invalid_token', message: 'No.' },
    })
    await annotateFailure(response)
    expect(spy).toHaveBeenCalledWith({
      failure: { code: 'invalid_token', message: 'No.' },
    })
    // The caller can still read the body.
    expect(await response.json()).toEqual({
      error: { code: 'invalid_token', message: 'No.' },
    })
    spy.mockRestore()
  })

  it('accepts a bare error string', async () => {
    const spy = vi
      .spyOn(requestLog, 'annotateRequest')
      .mockImplementation(() => undefined)
    await annotateFailure(json(400, { error: 'Bad input.' }))
    expect(spy).toHaveBeenCalledWith({ failure: { message: 'Bad input.' } })
    spy.mockRestore()
  })

  it('ignores successes and non-JSON replies', async () => {
    const spy = vi
      .spyOn(requestLog, 'annotateRequest')
      .mockImplementation(() => undefined)
    await annotateFailure(json(200, { ok: true }))
    await annotateFailure(new Response('nope', { status: 500 }))
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('annotateSummary', () => {
  it('writes a one-line message in production only', () => {
    const spy = vi
      .spyOn(requestLog, 'annotateRequest')
      .mockImplementation(() => undefined)
    const request = new Request('http://x.test/api/db/records?select=id')
    vi.stubEnv('NODE_ENV', 'production')
    annotateSummary(request, new Response('', { status: 200 }))
    expect(spy).toHaveBeenCalledWith({ message: 'GET /api/db/records 200' })
    spy.mockClear()
    vi.stubEnv('NODE_ENV', 'development')
    annotateSummary(request, new Response('', { status: 200 }))
    expect(spy).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
    spy.mockRestore()
  })
})
