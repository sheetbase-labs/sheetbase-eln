import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  EXTERNAL_RPC_SCOPES,
  EXTERNAL_TABLE_ACCESS,
  requiredScopes,
} from '#/lib/external-token'
import {
  HUMAN_SESSION_ONLY_RPCS,
  OPENAPI_SPEC_PATH,
  SCHEMA_AUTHORING_RPCS,
  buildServiceCredentialOpenApi,
  openApiRpcNames,
  openApiTableNames,
} from '#/lib/public-api-openapi'

const spec = buildServiceCredentialOpenApi()
const committed = JSON.parse(readFileSync(OPENAPI_SPEC_PATH, 'utf8')) as unknown

function operation(
  path: string,
  method: string,
): { 'x-sheetbase-scopes'?: string[] } {
  const item = spec.paths[path]
  expect(item, path).toBeTruthy()
  const op = item[method] as { 'x-sheetbase-scopes'?: string[] }
  expect(op, `${method} ${path}`).toBeTruthy()
  return op
}

describe('API-03 service-credential OpenAPI', () => {
  it('matches the committed spec file', () => {
    expect(committed).toEqual(spec)
  })

  it('lists exactly the API-07 allowlisted tables and RPCs', () => {
    expect(openApiTableNames(spec)).toEqual(
      Object.keys(EXTERNAL_TABLE_ACCESS).sort(),
    )
    expect(openApiRpcNames(spec)).toEqual(
      Object.keys(EXTERNAL_RPC_SCOPES).sort(),
    )
  })

  it('records the same scopes requiredScopes() enforces', () => {
    for (const [resource, scopes] of Object.entries(EXTERNAL_RPC_SCOPES)) {
      const operationItem = operation(`/api/db/rpc/${resource}`, 'post')
      expect(operationItem['x-sheetbase-scopes']).toEqual(scopes)
      expect(requiredScopes('POST', { kind: 'rpc', resource })).toEqual(scopes)
    }
    for (const [resource, access] of Object.entries(EXTERNAL_TABLE_ACCESS)) {
      const getOp = operation(`/api/db/${resource}`, 'get')
      expect(getOp['x-sheetbase-scopes']).toEqual([access.read])
      expect(requiredScopes('GET', { kind: 'table', resource })).toEqual([
        access.read,
      ])
    }
  })

  it('does not publish human-session attestation RPCs', () => {
    const rpcs = openApiRpcNames(spec)
    for (const name of HUMAN_SESSION_ONLY_RPCS) {
      expect(rpcs).not.toContain(name)
      expect(spec.info.description).toContain(name)
    }
    expect(spec.info.description).toMatch(/reviews:write/)
    expect(spec.info.description).toMatch(
      /does not open submit, sign, or amend/,
    )
  })

  it('does not present reviews:write as a usable credential operation', () => {
    const operations = Object.values(spec.paths).flatMap((path) =>
      Object.values(path).filter(
        (value) =>
          value && typeof value === 'object' && 'x-sheetbase-scopes' in value,
      ),
    ) as Array<{ 'x-sheetbase-scopes'?: string[] }>
    for (const op of operations) {
      expect(op['x-sheetbase-scopes']).not.toContain('reviews:write')
    }
    const preview = operation('/api/db/rpc/preview_submission_digest', 'post')
    expect(preview['x-sheetbase-scopes']).toEqual(['reviews:read'])
  })

  it('omits schema-authoring and scientific-table paths', () => {
    const rpcs = openApiRpcNames(spec)
    for (const name of SCHEMA_AUTHORING_RPCS) {
      expect(rpcs).not.toContain(name)
    }
    expect(rpcs).not.toContain('query_dataset')
    expect(rpcs).not.toContain('create_scientific_table')
    expect(
      Object.keys(spec.paths).some((path) => path.includes('sheet_')),
    ).toBe(true)
    expect(
      Object.keys(spec.paths).some((path) =>
        /^\/api\/db\/sheet_[a-z2-7]{26}$/.test(path),
      ),
    ).toBe(false)
  })

  it('documents token exchange and omits DELETE on projects', () => {
    expect(operation('/api/token', 'post')).toBeTruthy()
    expect(spec.paths['/api/db/projects'].delete).toBeUndefined()
    expect(spec.openapi).toBe('3.1.0')
  })

  it('documents Dataset INSERT but not PATCH or DELETE', () => {
    expect(operation('/api/db/datasets', 'post')['x-sheetbase-scopes']).toEqual(
      ['datasets:write'],
    )
    expect(spec.paths['/api/db/datasets'].patch).toBeUndefined()
    expect(spec.paths['/api/db/datasets'].delete).toBeUndefined()
    expect(operation('/api/db/datasets', 'head')['x-sheetbase-scopes']).toEqual(
      ['datasets:read'],
    )
  })
})
