import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ERROR_CATEGORIES } from '#/lib/errors'
import { buildExternalApiOpenApi } from '#/lib/public-api-openapi'
import { TOKEN_ERROR_CODES } from '#/lib/public-api-rpc-contracts'

type LanguageSupport = 'automatic' | 'generic' | 'resource'

interface SupportDecision {
  python: LanguageSupport
  typescript: LanguageSupport
}

interface SupportMatrix {
  contract: {
    apiVersion: string
    basePath: string
    source: string
    tokenErrorCodes: string[]
    errorCategories: string[]
  }
  token: Array<
    SupportDecision & {
      method: string
      path: string
    }
  >
  tables: Array<
    SupportDecision & {
      resource: string
      methods: string[]
    }
  >
  rpcs: Array<
    SupportDecision & {
      name: string
      resource: string
    }
  >
}

const matrixPath = 'sdks/support-matrix.json'
const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as SupportMatrix
const spec = buildExternalApiOpenApi()
const httpMethods = new Set(['get', 'head', 'post', 'patch', 'put', 'delete'])

function openApiOperations(): string[] {
  return Object.entries(spec.paths)
    .flatMap(([path, pathItem]) =>
      Object.keys(pathItem)
        .filter((method) => httpMethods.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

function matrixOperations(): string[] {
  return [
    ...matrix.token.map(({ method, path }) => `${method} ${path}`),
    ...matrix.tables.flatMap(({ resource, methods }) =>
      methods.map((method) => `${method} /api/db/${resource}`),
    ),
    ...matrix.rpcs.map(({ name }) => `POST /api/db/rpc/${name}`),
  ].sort()
}

function rpcPathsIn(files: string[]): string[] {
  const matches = files.flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/\/api\/db\/rpc\/([a-z_]+)/g)].map(
      (match) => match[1],
    ),
  )
  return [...new Set(matches)].sort()
}

function rpcWrapperBlock(file: string, name: string): string {
  const source = readFileSync(file, 'utf8')
  const marker = `/api/db/rpc/${name}`
  const markerIndex = source.indexOf(marker)
  expect(markerIndex, `${marker} in ${file}`).toBeGreaterThanOrEqual(0)
  const methodStarts = [
    ...source.matchAll(/\n\s+(?:(?:async\s+)?def|async)\s+[a-zA-Z_]\w*\s*\(/g),
  ].map((match) => match.index)
  const start = methodStarts.filter((index) => index <= markerIndex).at(-1) ?? 0
  const end = methodStarts.find((index) => index > markerIndex)
  return source.slice(start, end)
}

function rpcRequiredParameters(name: string): string[] {
  const operation = spec.paths[`/api/db/rpc/${name}`].post as {
    requestBody: {
      content: { 'application/json': { schema: { required?: string[] } } }
    }
  }
  return operation.requestBody.content['application/json'].schema.required ?? []
}

function declaredStrings(file: string, name: string): string[] {
  const source = readFileSync(file, 'utf8')
  const declaration = source.match(
    new RegExp(`${name}\\s*=\\s*[\\[(]([\\s\\S]*?)[\\])]`),
  )
  expect(declaration, `${name} in ${file}`).toBeTruthy()
  return [...(declaration?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  )
}

const pythonResources = [
  'agent_operations',
  'catalogues',
  'datasets',
  'projects',
  'records',
  'search',
  'sheets',
  'webhooks',
].map((name) => `sdks/python/src/sheetbase/resources/${name}.py`)

const typescriptResources = [
  'agent-operations',
  'catalogues',
  'datasets',
  'projects',
  'records',
  'search',
  'sheets',
  'webhooks',
].map((name) => `sdks/typescript/src/resources/${name}.ts`)

const resourceFiles: Partial<
  Record<string, { python: string; typescript: string }>
> = {
  agentOperations: {
    python: 'sdks/python/src/sheetbase/resources/agent_operations.py',
    typescript: 'sdks/typescript/src/resources/agent-operations.ts',
  },
  catalogues: {
    python: 'sdks/python/src/sheetbase/resources/catalogues.py',
    typescript: 'sdks/typescript/src/resources/catalogues.ts',
  },
  datasets: {
    python: 'sdks/python/src/sheetbase/resources/datasets.py',
    typescript: 'sdks/typescript/src/resources/datasets.ts',
  },
  projects: {
    python: 'sdks/python/src/sheetbase/resources/projects.py',
    typescript: 'sdks/typescript/src/resources/projects.ts',
  },
  records: {
    python: 'sdks/python/src/sheetbase/resources/records.py',
    typescript: 'sdks/typescript/src/resources/records.ts',
  },
  search: {
    python: 'sdks/python/src/sheetbase/resources/search.py',
    typescript: 'sdks/typescript/src/resources/search.ts',
  },
  sheets: {
    python: 'sdks/python/src/sheetbase/resources/sheets.py',
    typescript: 'sdks/typescript/src/resources/sheets.ts',
  },
  webhooks: {
    python: 'sdks/python/src/sheetbase/resources/webhooks.py',
    typescript: 'sdks/typescript/src/resources/webhooks.ts',
  },
}

describe('SDK-01 public-contract support matrix', () => {
  it('covers the generated contract exactly once', () => {
    const operations = matrixOperations()
    expect(operations).toEqual(openApiOperations())
    expect(new Set(operations).size).toBe(operations.length)
    expect(matrix.contract.apiVersion).toBe(spec.info.version)
    expect(matrix.contract.basePath).toBe('/api/db')
    expect(matrix.contract.source).toBe('docs/openapi/external-api-v0.json')
  })

  it('keeps version and error semantics aligned with the server contract', () => {
    expect(matrix.contract.tokenErrorCodes).toEqual(TOKEN_ERROR_CODES)
    expect(matrix.contract.errorCategories).toEqual(ERROR_CATEGORIES)

    for (const file of [
      'sdks/python/src/sheetbase/errors.py',
      'sdks/typescript/src/errors.ts',
    ]) {
      expect(declaredStrings(file, 'TOKEN_ERROR_CODES')).toEqual(
        matrix.contract.tokenErrorCodes,
      )
      expect(declaredStrings(file, 'ERROR_CATEGORIES')).toEqual(
        matrix.contract.errorCategories,
      )
    }
    expect(
      readFileSync('sdks/python/src/sheetbase/_version.py', 'utf8'),
    ).toContain(`API_VERSION = "${matrix.contract.apiVersion}"`)
    expect(readFileSync('sdks/typescript/src/version.ts', 'utf8')).toContain(
      `API_VERSION = "${matrix.contract.apiVersion}"`,
    )
  })

  it('makes deliberate and identical Python/TypeScript decisions', () => {
    const decisions = [...matrix.token, ...matrix.tables, ...matrix.rpcs]
    for (const decision of decisions) {
      expect(decision.python).toBe(decision.typescript)
    }
    expect(matrix.token.every((entry) => entry.python === 'automatic')).toBe(
      true,
    )
    expect(matrix.tables.every((entry) => entry.python === 'generic')).toBe(
      true,
    )
    expect(matrix.rpcs.every((entry) => entry.python === 'resource')).toBe(true)
  })

  it('has one dedicated wrapper in each SDK for every and only public RPC', () => {
    const names = matrix.rpcs.map(({ name }) => name).sort()
    expect(rpcPathsIn(pythonResources)).toEqual(names)
    expect(rpcPathsIn(typescriptResources)).toEqual(names)
    for (const { name, resource } of matrix.rpcs) {
      const files = resourceFiles[resource]
      expect(files, `${name} has a known resource`).toBeDefined()
      if (!files) throw new Error(`Unknown SDK resource: ${resource}`)
      expect(readFileSync(files.python, 'utf8')).toContain(
        `/api/db/rpc/${name}`,
      )
      expect(readFileSync(files.typescript, 'utf8')).toContain(
        `/api/db/rpc/${name}`,
      )
      for (const parameter of rpcRequiredParameters(name)) {
        expect(rpcWrapperBlock(files.python, name)).toContain(parameter)
        expect(rpcWrapperBlock(files.typescript, name)).toContain(parameter)
      }
    }
  })

  it('implements every generic table method in both clients', () => {
    const pythonClient = readFileSync(
      'sdks/python/src/sheetbase/client.py',
      'utf8',
    )
    const asyncPythonClient = readFileSync(
      'sdks/python/src/sheetbase/async_client.py',
      'utf8',
    )
    const typescriptClient = readFileSync(
      'sdks/typescript/src/client.ts',
      'utf8',
    )
    for (const method of ['get', 'head', 'post', 'patch']) {
      expect(pythonClient).toMatch(new RegExp(`def table_${method}\\(`))
      expect(asyncPythonClient).toMatch(
        new RegExp(`async def table_${method}\\(`),
      )
      expect(typescriptClient).toMatch(
        new RegExp(
          `async table${method[0].toUpperCase()}${method.slice(1)}\\(`,
        ),
      )
    }
  })
})
