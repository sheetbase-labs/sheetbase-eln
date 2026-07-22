import { describe, expect, it } from 'vitest'

import {
  categorisePostgrestError,
  categoriseProxyError,
  errorEnvelope,
} from './errors'
import type { ProxyErrorCode } from './errors'

describe('categorisePostgrestError', () => {
  it('maps unique violation to conflict', () => {
    const out = categorisePostgrestError(409, {
      code: '23505',
      message: 'dup',
    })
    expect(out).toEqual({ category: 'conflict', status: 409, message: 'dup' })
  })

  it('maps insufficient_privilege to permission_denied', () => {
    const out = categorisePostgrestError(403, {
      code: '42501',
      message: 'no',
    })
    expect(out.category).toBe('permission_denied')
  })

  it('falls back to status inference when code is unknown', () => {
    const out = categorisePostgrestError(404, { code: 'P0001', message: 'x' })
    expect(out.category).toBe('not_found')
  })

  it('falls back to status inference when code is empty string', () => {
    const out = categorisePostgrestError(400, { code: '', message: 'bad' })
    expect(out.category).toBe('validation_error')
  })

  it('falls back to status inference when body is null', () => {
    const out = categorisePostgrestError(500, null)
    expect(out.category).toBe('service_unavailable')
    expect(out.message).toBe('Request failed.')
  })

  it('treats undefined_table as service_unavailable', () => {
    const out = categorisePostgrestError(500, { code: '42P01' })
    expect(out.category).toBe('service_unavailable')
  })

  it('maps the Sheetbase stale_version SQLSTATE to stale_version', () => {
    const out = categorisePostgrestError(400, {
      code: 'SB001',
      message: 'stale',
    })
    expect(out).toEqual({
      category: 'stale_version',
      status: 409,
      message: 'stale',
    })
  })

  it('maps the Sheetbase missing_link SQLSTATE to missing_link', () => {
    const out = categorisePostgrestError(400, {
      code: 'SB002',
      message: 'no target',
    })
    expect(out).toMatchObject({ category: 'missing_link', status: 422 })
  })

  it('maps the Sheetbase invalid-payload SQLSTATE to validation_error', () => {
    const out = categorisePostgrestError(400, {
      code: 'SB003',
      message: 'bad payload',
    })
    expect(out.category).toBe('validation_error')
  })

  it('maps the Sheetbase template-not-instantiable SQLSTATE to template_not_instantiable', () => {
    const out = categorisePostgrestError(400, {
      code: 'SB006',
      message: 'cannot instantiate from a draft template',
    })
    expect(out).toMatchObject({
      category: 'template_not_instantiable',
      status: 422,
    })
  })
})

describe('categoriseProxyError', () => {
  it.each<[ProxyErrorCode, string, number]>([
    ['unauthenticated', 'unauthenticated', 401],
    ['no_workspace', 'permission_denied', 403],
    ['workspace_mismatch', 'permission_denied', 403],
    ['invalid_path', 'validation_error', 400],
    ['upstream_unavailable', 'service_unavailable', 502],
  ])('maps %s to %s (%d)', (code, category, status) => {
    const out = categoriseProxyError(code)
    expect(out.category).toBe(category as never)
    expect(out.status).toBe(status)
    expect(out.message).toBeDefined()
  })
})

describe('errorEnvelope', () => {
  it('includes request_id when provided', () => {
    const response = errorEnvelope({
      category: 'conflict',
      status: 409,
      message: 'dup',
      requestId: 'req-1',
    })
    expect(response.status).toBe(409)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('omits request_id when not provided', async () => {
    const response = errorEnvelope({
      category: 'validation_error',
      status: 400,
      message: 'bad',
    })
    const body = await response.json()
    expect(body.error.request_id).toBeUndefined()
  })
})
