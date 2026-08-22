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
  buildExternalApiOpenApi,
  openApiRpcNames,
  openApiTableNames,
} from '#/lib/public-api-openapi'
import {
  POSTGREST_FILTER_OPERATORS,
  RPC_CONTRACTS,
  TOKEN_ERROR_CODES,
} from '#/lib/public-api-rpc-contracts'

const spec = buildExternalApiOpenApi()
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

describe('API-03 external OpenAPI', () => {
  it('keeps generate-routes and adds openapi:generate', () => {
    expect(packageJson.scripts['generate-routes']).toBe('tsr generate')
    expect(packageJson.scripts['openapi:generate']).toContain(
      'scripts/generate-public-openapi.ts',
    )
  })

  it('describes one external surface covering both credential kinds', () => {
    expect(spec.info.title).toBe('Sheetbase external API')
    const description = spec.info.description
    // Service credentials act as the workspace identity; personal tokens act
    // as their creating member.
    expect(description).toMatch(/role: 'api_client'/)
    expect(description).toMatch(/role: 'authenticated'/)
    expect(description).toMatch(/creating member/)
    expect(description).toMatch(/same canonical scopes/)
    expect(description).toMatch(/fail-closed external allowlist/)
  })

  it('states personal tokens have no browser session and stop with membership', () => {
    const description = spec.info.description
    expect(description).toMatch(/Removing or suspending the creating member/)
    expect(description).toMatch(/no `session_id` claim/)
    const bearer = spec.components.securitySchemes.bearerAuth as {
      description: string
    }
    expect(bearer.description).toMatch(/role=api_client/)
    expect(bearer.description).toMatch(/role=authenticated/)
    expect(bearer.description).toMatch(/no session_id claim/)
  })

  it('documents token exchange accepting both credential kinds', () => {
    const op = operation('/api/token', 'post') as { description: string }
    expect(op.description).toMatch(/service credentials/)
    expect(op.description).toMatch(/personal API tokens/)
    const body = (operation('/api/token', 'post').requestBody as RequestBody)
      .content['application/json'].schema
    expect(body.$ref).toBe('#/components/schemas/TokenExchangeRequest')
    const requestSchema = spec.components.schemas.TokenExchangeRequest as {
      properties: { credential: { description: string } }
    }
    expect(requestSchema.properties.credential.description).toMatch(
      /[Bb]oth service credentials and personal tokens/,
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

  it('omits POST and PATCH on folders and record_field_definitions', () => {
    for (const resource of ['folders', 'record_field_definitions']) {
      expect(operation(`/api/db/${resource}`, 'get')).toBeTruthy()
      expect(spec.paths[`/api/db/${resource}`].post).toBeUndefined()
      expect(spec.paths[`/api/db/${resource}`].patch).toBeUndefined()
    }
    expect(spec.info.description).toMatch(/folders.*GET-only/)
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

  it('publishes concrete table GET/POST/PATCH schemas', () => {
    for (const resource of Object.keys(EXTERNAL_TABLE_ACCESS)) {
      const getSchema = jsonContentSchema(
        operation(`/api/db/${resource}`, 'get').responses,
        '200',
      )
      expect(getSchema.type).toBe('array')
      expect(getSchema.items).toEqual({
        $ref: `#/components/schemas/${pascalRow(resource)}`,
      })
      assertConcreteSchema(
        spec.components.schemas[pascalRow(resource)],
        `${resource} row`,
      )

      const access = EXTERNAL_TABLE_ACCESS[resource]
      if (!access.write) {
        expect(spec.paths[`/api/db/${resource}`].post).toBeUndefined()
        expect(spec.paths[`/api/db/${resource}`].patch).toBeUndefined()
        continue
      }

      const postSchema = jsonContentSchema(
        (operation(`/api/db/${resource}`, 'post').requestBody as RequestBody)
          .content,
        'request',
      )
      expect(postSchema.$ref).toMatch(
        new RegExp(`${pascalRow(resource)}Insert$`),
      )
      assertConcreteSchema(
        spec.components.schemas[`${pascalRow(resource)}Insert`],
        `${resource} insert`,
      )
      const created = jsonContentSchema(
        operation(`/api/db/${resource}`, 'post').responses,
        '201',
      )
      expect(created.oneOf).toBeTruthy()

      if (resource === 'datasets') {
        expect(spec.paths['/api/db/datasets'].patch).toBeUndefined()
        continue
      }
      const patchSchema = jsonContentSchema(
        (operation(`/api/db/${resource}`, 'patch').requestBody as RequestBody)
          .content,
        'request',
      )
      expect(patchSchema.$ref).toMatch(
        new RegExp(`${pascalRow(resource)}Patch$`),
      )
      assertConcreteSchema(
        spec.components.schemas[`${pascalRow(resource)}Patch`],
        `${resource} patch`,
      )
    }
  })

  it('publishes concrete RPC request and result schemas', () => {
    for (const name of Object.keys(EXTERNAL_RPC_SCOPES)) {
      const request = rpcRequestSchema(name) as JsonNode
      assertConcreteSchema(request, `${name} request`)
      const result = jsonContentSchema(
        operation(`/api/db/rpc/${name}`, 'post').responses,
        '200',
      )
      assertConcreteSchema(result, `${name} result`)
    }

    const parameterInputs = rpcRequestSchema(
      'preview_sheet_instance_composition_adoption',
    ).properties?.p_parameter_inputs as {
      type: string
      items: { $ref: string }
    }
    expect(parameterInputs.type).toBe('array')
    expect(parameterInputs.items.$ref).toBe(
      '#/components/schemas/SheetParameterInput',
    )

    const changes = rpcRequestSchema('mutate_sheet_instance_calculations')
      .properties?.p_changes as {
      type: string
      items: { $ref: string }
      minItems: number
      maxItems: number
    }
    expect(changes.type).toBe('array')
    expect(changes.items.$ref).toBe(
      '#/components/schemas/SheetCalculationChange',
    )
    expect(changes.minItems).toBe(1)
    expect(changes.maxItems).toBe(32)

    const sheetDecisions = rpcRequestSchema(
      'apply_sheet_instance_definition_upgrade',
    ).properties?.p_decisions as { type: string; items: { $ref: string } }
    expect(sheetDecisions.type).toBe('array')
    expect(sheetDecisions.items.$ref).toBe(
      '#/components/schemas/SheetDefinitionUpgradeDecision',
    )

    const notebookDecisions = rpcRequestSchema(
      'apply_notebook_template_upgrade',
    ).properties?.p_decisions as { type: string; items: { $ref: string } }
    expect(notebookDecisions.type).toBe('array')
    expect(notebookDecisions.items.$ref).toBe(
      '#/components/schemas/NotebookUpgradeDecision',
    )
  })

  it('publishes API-07 credential-attribution columns on strict row schemas', () => {
    const datasets = spec.components.schemas.DatasetsRow as {
      additionalProperties: boolean
      properties: Record<string, unknown>
    }
    const datasetVersions = spec.components.schemas.DatasetVersionsRow as {
      properties: Record<string, unknown>
    }
    const sheetInstances = spec.components.schemas.SheetInstancesRow as {
      properties: Record<string, unknown>
    }
    const records = spec.components.schemas.RecordsRow as {
      properties: Record<string, unknown>
    }
    expect(datasets.additionalProperties).toBe(false)
    expect(datasets.properties).toHaveProperty('created_by_credential_id')
    expect(datasetVersions.properties).toHaveProperty(
      'created_by_credential_id',
    )
    expect(sheetInstances.properties).toHaveProperty('created_by_credential_id')
    expect(sheetInstances.properties).toHaveProperty('updated_by_credential_id')
    expect(records.properties).toHaveProperty('updated_by_credential_id')
  })

  it('uses named JSON unions instead of empty value schemas', () => {
    const parameterInput = spec.components.schemas.SheetParameterInput as {
      oneOf: Array<{ properties?: { value?: { $ref?: string } } }>
    }
    expect(parameterInput.oneOf[0]?.properties?.value?.$ref).toBe(
      '#/components/schemas/JsonScalar',
    )
    const calculationResult = spec.components.schemas
      .SheetCalculationResult as {
      properties: { calculatedValue: { $ref?: string } }
    }
    expect(calculationResult.properties.calculatedValue.$ref).toBe(
      '#/components/schemas/JsonValue',
    )
    const jsonScalar = spec.components.schemas.JsonScalar as {
      oneOf: Array<{ type?: string }>
    }
    expect(jsonScalar.oneOf.map((branch) => branch.type).sort()).toEqual([
      'boolean',
      'null',
      'number',
      'string',
    ])
    expect(jsonScalar.oneOf.some((branch) => branch.type === 'integer')).toBe(
      false,
    )
  })
})

type JsonNode = Record<string, unknown>
type Responses = Record<
  string,
  { content?: { 'application/json': { schema: JsonNode } } }
>
type RequestBody = {
  content: { 'application/json': { schema: JsonNode } }
}

function pascalRow(table: string): string {
  return `${table
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Row`
}

function jsonContentSchema(
  source: Responses | RequestBody['content'] | unknown,
  key: string,
): JsonNode {
  if (key === 'request') {
    return (source as RequestBody['content'])['application/json'].schema
  }
  const response = (source as Responses)[key]
  const schema = response.content?.['application/json']?.schema
  expect(schema, `${key} JSON schema`).toBeTruthy()
  return schema as JsonNode
}

const SCHEMA_SHAPE_KEYS = new Set([
  '$ref',
  'type',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'properties',
  'items',
  'prefixItems',
  'additionalProperties',
  'const',
  'enum',
])

function assertConcreteSchema(
  schema: JsonNode,
  label: string,
  seen = new Set<string>(),
) {
  const walk = (node: unknown, path: string) => {
    if (node === true) return
    if (node === false) {
      throw new Error(`${label}: forbidden schema at ${path}`)
    }
    if (!node || typeof node !== 'object') {
      throw new Error(
        `${label}: expected a schema object at ${path}, got ${typeof node}`,
      )
    }
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries())
        walk(item, `${path}[${index}]`)
      return
    }
    const objectNode = node as JsonNode
    const shapeKeys = Object.keys(objectNode).filter((key) =>
      SCHEMA_SHAPE_KEYS.has(key),
    )
    if (shapeKeys.length === 0) {
      throw new Error(
        `${label}: empty schema at ${path} (need type, $ref, oneOf, properties, items, or additionalProperties)`,
      )
    }
    if (typeof objectNode.$ref === 'string') {
      const name = objectNode.$ref.replace('#/components/schemas/', '')
      if (seen.has(name)) return
      seen.add(name)
      const target = spec.components.schemas[name]
      expect(
        target,
        `${label} missing ${objectNode.$ref} at ${path}`,
      ).toBeTruthy()
      walk(target, `${path}->${name}`)
      return
    }
    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      if (Array.isArray(objectNode[key])) {
        expect(
          (objectNode[key] as unknown[]).length,
          `${label} ${path}.${key} must not be empty`,
        ).toBeGreaterThan(0)
        walk(objectNode[key], `${path}.${key}`)
      }
    }
    if (objectNode.not) walk(objectNode.not, `${path}.not`)
    if (
      objectNode.type === 'array' ||
      objectNode.items ||
      objectNode.prefixItems
    ) {
      expect(
        objectNode.items ?? objectNode.prefixItems,
        `${label} ${path} array items`,
      ).toBeTruthy()
      if (objectNode.items) walk(objectNode.items, `${path}.items`)
      if (objectNode.prefixItems)
        walk(objectNode.prefixItems, `${path}.prefixItems`)
    }
    const types = Array.isArray(objectNode.type)
      ? objectNode.type
      : objectNode.type
        ? [objectNode.type]
        : []
    const isObject =
      types.includes('object') ||
      objectNode.properties !== undefined ||
      objectNode.additionalProperties !== undefined
    if (objectNode.properties) {
      expect(
        typeof objectNode.properties === 'object' &&
          !Array.isArray(objectNode.properties),
        `${label} ${path}.properties`,
      ).toBe(true)
      const properties = objectNode.properties as Record<string, unknown>
      expect(
        Object.keys(properties).length,
        `${label} ${path} object properties`,
      ).toBeGreaterThan(0)
      for (const [key, child] of Object.entries(properties)) {
        walk(child, `${path}.properties.${key}`)
      }
    }
    if (
      objectNode.additionalProperties &&
      typeof objectNode.additionalProperties === 'object'
    ) {
      walk(objectNode.additionalProperties, `${path}.additionalProperties`)
    }
    if (
      isObject &&
      !objectNode.properties &&
      objectNode.additionalProperties !== true &&
      typeof objectNode.additionalProperties !== 'object'
    ) {
      throw new Error(
        `${label}: generic object schema at ${path} (need properties, $ref, oneOf, or additionalProperties)`,
      )
    }
  }
  walk(schema, label)
}
