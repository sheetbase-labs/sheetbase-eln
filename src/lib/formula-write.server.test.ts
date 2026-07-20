// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { handleFormulaWrite } from './formula-write.server'
import type { FormulaWriteDeps } from './formula-write.server'

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://test:test@localhost:5432/test'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

const tableId = '10000000-0000-4000-8000-000000000001'
const rowId = '10000000-0000-4000-8000-000000000002'
const columnId = '10000000-0000-4000-8000-000000000003'

function request(body: unknown) {
  return new Request('http://sheetbase.test/api/formulas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function deps(authenticated = true) {
  const trustedWrite = vi.fn().mockResolvedValue({
    formulaId: '10000000-0000-4000-8000-000000000004',
    version: 1,
    status: 'supported',
  })
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          id: tableId,
          resource_name: `sheet_${'a'.repeat(26)}`,
          schema_version: 2,
          lifecycle: 'active',
          workspace_status: 'active',
          membership_id: '10000000-0000-4000-8000-000000000009',
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ id: columnId }] })
    .mockResolvedValueOnce({ rows: [{ id: rowId }] })
  return {
    value: {
      getSession: vi
        .fn()
        .mockResolvedValue(
          authenticated ? { user: { id: 'server-actor' } } : null,
        ),
      query,
      trustedWrite,
    } as unknown as FormulaWriteDeps,
    trustedWrite,
  }
}

describe('formula write route contract', () => {
  it('rejects unauthenticated requests before processing input', async () => {
    const mock = deps(false)
    const response = await handleFormulaWrite(request({}), mock.value)
    expect(response.status).toBe(401)
    expect(mock.trustedWrite).not.toHaveBeenCalled()
  })

  it('rejects extra fields and client-supplied artifacts', async () => {
    const mock = deps()
    const response = await handleFormulaWrite(
      request({
        operation: 'create',
        target: { tableId, rowId, columnId },
        expectedSchemaVersion: 2,
        expectedRowVersion: 1,
        source: '=A1',
        artifact: { source: '=malicious' },
      }),
      mock.value,
    )
    expect(response.status).toBe(400)
    expect(mock.trustedWrite).not.toHaveBeenCalled()
  })

  it('derives the persisted artifact and actor on the server', async () => {
    const mock = deps()
    const response = await handleFormulaWrite(
      request({
        operation: 'create',
        target: { tableId, rowId, columnId },
        expectedSchemaVersion: 2,
        expectedRowVersion: 1,
        source: '=A1+2',
      }),
      mock.value,
    )
    expect(response.status).toBe(200)
    expect(mock.trustedWrite).toHaveBeenCalledWith(
      'server-actor',
      expect.objectContaining({
        operation: 'create',
        artifact: expect.objectContaining({
          source: '=A1+2',
          status: 'supported',
          dependencies: [{ tableId, rowId, columnId }],
        }),
      }),
    )
  })

  it('returns formula syntax errors as safe validation responses', async () => {
    const mock = deps()
    const response = await handleFormulaWrite(
      request({
        operation: 'create',
        target: { tableId, rowId, columnId },
        expectedSchemaVersion: 2,
        expectedRowVersion: 1,
        source: '=100%%',
      }),
      mock.value,
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'syntax' },
    })
    expect(mock.trustedWrite).not.toHaveBeenCalled()
  })
})
