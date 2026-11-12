import { describe, expect, it, vi } from 'vitest'

import { handleVersionFile } from './pipeline-version-file.server'
import type { VersionFileDeps } from './pipeline-version-file.server'

// oxlint-disable-next-line anti-slop/no-module-mocking -- env.server reads the deployment environment at import; the handler takes its session and token checks as an argument, so no connection is opened.
vi.mock('#/env.server', () => ({ env: { DATABASE_URL: 'postgres://unused' } }))

// oxlint-disable-next-line anti-slop/no-module-mocking -- auth reads the request headers through the framework's server context; the handler takes its session as an argument.
vi.mock('#/lib/auth', () => ({ getAppSession: vi.fn() }))

const asPerson: VersionFileDeps = {
  getSession: () => Promise.resolve({ user: { id: 'u-1' } }),
  checkToken: () => Promise.resolve(false),
}

const asToken: VersionFileDeps = {
  getSession: () => Promise.resolve(null),
  checkToken: () => Promise.resolve(true),
}

const nobody: VersionFileDeps = {
  getSession: () => Promise.resolve(null),
  checkToken: () => Promise.resolve(false),
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a test helper: the body is whatever shape the case wants to send.
const post = (body: unknown, deps: VersionFileDeps) =>
  handleVersionFile(
    new Request('http://x/api/pipelines/version-file', {
      method: 'POST',
      headers: { authorization: 'Bearer abc' },
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- a raw string is sent as it is, anything else as JSON.
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    deps,
  )

const FILE = [
  'pipeline: PL-0021',
  'steps:',
  '  - id: a',
  '    sql: SELECT 1',
  'output:',
  '  mode: none',
  '  dataset_label: ""',
  '',
].join('\n')

describe('POST /api/pipelines/version-file', () => {
  it('refuses a caller with no session and no token', async () => {
    expect((await post({ text: FILE }, nobody)).status).toBe(401)
  })

  it('reads a file into its configuration', async () => {
    const response = await post({ text: FILE, pipeline: 'PL-0021' }, asToken)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.configuration.steps[0]).toMatchObject({
      name: 'a',
      kind: 'sql',
    })
    expect(body.configuration.mode).toBe('advanced')
  })

  it('answers every mistake with its line and column', async () => {
    const body = await (
      await post({ text: FILE.replace('sql:', 'sqll:') }, asPerson)
    ).json()

    expect(body.ok).toBe(false)
    expect(body.configuration).toBeNull()
    expect(body.problems[0]).toMatchObject({ line: 4, column: 5 })
  })

  it('writes a configuration out as its file and reads it back the same', async () => {
    const read = await (await post({ text: FILE }, asPerson)).json()

    const written = await (
      await post(
        { configuration: read.configuration, pipeline: 'PL-0021', version: 3 },
        asPerson,
      )
    ).json()

    expect(written.text).toContain('pipeline: PL-0021')
    expect(written.text).toContain('version: 3')

    const again = await (await post({ text: written.text }, asPerson)).json()

    expect(again.configuration).toEqual(read.configuration)
  })

  it('refuses a body that is neither', async () => {
    expect((await post({ nope: 1 }, asPerson)).status).toBe(400)
    expect((await post('not json', asPerson)).status).toBe(400)
  })
})
