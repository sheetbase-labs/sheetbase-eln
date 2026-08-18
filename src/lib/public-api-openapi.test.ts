import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  EXTERNAL_RPC_SCOPES,
  EXTERNAL_TABLE_ACCESS,
  requiredScopes,
} from '#/lib/external-token'
import { errorEnvelope } from '#/lib/errors'
import { handleProxyRequest } from '#/lib/postgrest-proxy'
import {
  HUMAN_SESSION_ONLY_RPCS,
  OPENAPI_SPEC_PATH,
  SCHEMA_AUTHORING_RPCS,
  buildServiceCredentialOpenApi,
  openApiRpcNames,
  openApiTableNames,
} from '#/lib/public-api-openapi'
import {
  POSTGREST_FILTER_OPERATORS,
  RPC_CONTRACTS,
  TOKEN_ERROR_CODES,
} from '#/lib/public-api-rpc-contracts'

const spec = buildServiceCredentialOpenApi()
const committed = JSON.parse(readFileSync(OPENAPI_SPEC_PATH, 'utf8')) as unknown
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}

function operation(path: string, method: string): Record<string, unknown> {
  const item = spec.paths[path]
  expect(item, path).toBeTruthy()
  const op = item[method] as Record<string, unknown>
  expect(op, `${method} ${path}`).toBeTruthy()
  return op
}

function rpcRequestSchema(name: string): {
  additionalProperties?: boolean
  required?: string[]
  properties?: Record<string, unknown>
} {
  const op = operation(`/api/db/rpc/${name}`, 'post')
  const body = op.requestBody as {
    content: { 'application/json': { schema: Record<string, unknown> } }
  }
  return body.content['application/json'].schema
}

describe('API-03 service-credential OpenAPI', () => {
  it('keeps generate-routes and adds openapi:generate', () => {
    expect(packageJson.scripts['generate-routes']).toBe('tsr generate')
    expect(packageJson.scripts['openapi:generate']).toContain(
      'scripts/generate-public-openapi.ts',
    )
  })

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

  it('splits token and proxy error schemas', () => {
    const tokenError = spec.components.schemas.TokenError as {
      properties: { error: { required: string[]; properties: object } }
    }
    const proxyError = spec.components.schemas.ProxyError as {
      properties: { error: { required: string[]; properties: object } }
    }
    expect(tokenError.properties.error.required).toEqual(['code', 'message'])
    expect(tokenError.properties.error.properties).toHaveProperty('code')
    expect(tokenError.properties.error.properties).not.toHaveProperty(
      'category',
    )
    expect(proxyError.properties.error.required).toEqual([
      'category',
      'message',
    ])
    expect(proxyError.properties.error.properties).toHaveProperty('category')
    expect(proxyError.properties.error.properties).not.toHaveProperty('code')

    const token400 = (
      operation('/api/token', 'post').responses as Record<
        string,
        { content: { 'application/json': { schema: { $ref: string } } } }
      >
    )['400']
    expect(token400.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/TokenError',
    )
    const db403 = (
      operation('/api/db/projects', 'get').responses as Record<
        string,
        { content: { 'application/json': { schema: { $ref: string } } } }
      >
    )['403']
    expect(db403.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ProxyError',
    )
  })

  it('matches real token and proxy error envelopes', async () => {
    const tokenBody = {
      error: { code: 'invalid_credential', message: 'Invalid credential.' },
    }
    expect(TOKEN_ERROR_CODES).toContain(tokenBody.error.code)
    expect(tokenBody.error).not.toHaveProperty('category')

    const proxyResponse = errorEnvelope({
      category: 'stale_version',
      status: 409,
      message: 'Block version mismatch.',
      requestId: 'req-test',
    })
    const proxyBody = (await proxyResponse.json()) as {
      error: Record<string, unknown>
    }
    expect(Object.keys(proxyBody.error).sort()).toEqual([
      'category',
      'message',
      'request_id',
    ])
    expect(proxyBody.error).not.toHaveProperty('code')

    const invalidPath = await handleProxyRequest(
      new Request('http://localhost/api/db/not a path'),
      'not a path',
      {
        getSession: async () => null,
        getWorkspaceForUser: async () => null,
        mintToken: async () => '',
        upstreamBaseUrl: 'http://upstream',
      },
    )
    const invalidBody = (await invalidPath.json()) as {
      error: Record<string, unknown>
    }
    expect(invalidPath.status).toBe(400)
    expect(invalidBody.error.category).toBe('validation_error')
    expect(invalidBody.error).not.toHaveProperty('code')
    expect(invalidBody.error).toHaveProperty('request_id')
  })

  it('documents concrete RPC arguments for every allowlisted RPC', () => {
    expect(Object.keys(RPC_CONTRACTS).sort()).toEqual(
      Object.keys(EXTERNAL_RPC_SCOPES).sort(),
    )
    for (const name of Object.keys(EXTERNAL_RPC_SCOPES)) {
      const schema = rpcRequestSchema(name)
      const contract = RPC_CONTRACTS[name]
      expect(schema.additionalProperties).toBe(false)
      expect(schema.properties).toEqual(contract.properties)
      expect(schema.required ?? []).toEqual(contract.required)
      const propertyNames = Object.keys(schema.properties ?? {})
      expect(propertyNames.length).toBeGreaterThan(0)
      expect(propertyNames.every((key) => key.startsWith('p_'))).toBe(true)
    }
  })

  it('documents Dataset commit idempotency field and retry result', () => {
    const schema = rpcRequestSchema('commit_dataset_row_batch')
    expect(schema.required).toContain('p_idempotency_key')
    const key = schema.properties?.p_idempotency_key as {
      minLength: number
      maxLength: number
    }
    expect(key.minLength).toBe(1)
    expect(key.maxLength).toBe(128)
    const result = (
      operation('/api/db/rpc/commit_dataset_row_batch', 'post')
        .responses as Record<
        string,
        { content: { 'application/json': { schema: Record<string, unknown> } } }
      >
    )['200'].content['application/json'].schema
    const properties = result.properties as Record<string, { type?: string }>
    expect(properties.idempotent.type).toBe('boolean')
    expect(
      operation('/api/db/rpc/commit_dataset_row_batch', 'post').description,
    ).toMatch(/idempotent: true/)
  })

  it('documents table Prefer count and filter operators', () => {
    const getOp = operation('/api/db/records', 'get')
    const parameters = getOp.parameters as Array<{ $ref?: string }>
    const refs = parameters.map((parameter) => parameter.$ref)
    expect(refs).toContain('#/components/parameters/Prefer')
    expect(refs).toContain('#/components/parameters/ColumnFilter')
    expect(refs).toContain('#/components/parameters/Limit')
    const prefer = spec.components.parameters.Prefer as {
      description: string
    }
    expect(prefer.description).toMatch(/count=exact/)
    const filter = spec.components.parameters.ColumnFilter as {
      description: string
    }
    for (const operator of ['eq', 'gte', 'in', 'ilike']) {
      expect(filter.description).toContain(operator)
    }
    expect(POSTGREST_FILTER_OPERATORS).toContain('eq')
  })

  it('documents query_dataset_rows filter object and bounds', () => {
    const schema = rpcRequestSchema('query_dataset_rows')
    const query = schema.properties?.p_query as {
      properties: { filters: { maxItems: number }; sort: object }
    }
    expect(query.properties.filters.maxItems).toBe(8)
    expect(query.properties.sort).toBeTruthy()
    const limit = schema.properties?.p_limit as {
      minimum: number
      maximum: number
    }
    expect(limit.minimum).toBe(1)
    expect(limit.maximum).toBe(1000)
  })
})
