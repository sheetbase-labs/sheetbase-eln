import { describe, expect, it, vi } from 'vitest'

import { PipelinePythonError } from './pipeline-python.server'
import {
  TEST_RESULT_ROWS,
  handlePythonTestRun,
  testRunRequestError,
} from './pipeline-python-test.server'
import type { PythonTestRunDeps } from './pipeline-python-test.server'

vi.mock('#/lib/auth', () => ({ getAppSession: vi.fn() }))

type ExecuteInput = Parameters<PythonTestRunDeps['execute']>[0]

const runtime = `ghcr.io/example/python@sha256:${'a'.repeat(64)}`
const good = {
  statement: 'def transform(inputs, parameters): return inputs["r"]',
  inputs: { r: [{ v: 1 }] },
  parameters: {},
}

function deps(over: Partial<PythonTestRunDeps> = {}): PythonTestRunDeps {
  return {
    getSession: async () => ({ user: { id: 'u-1' } }),
    getWriterWorkspace: async () => 'ws-1',
    execute: vi.fn(async () => ({ rows: [{ v: 1 }], logs: ['ok'], runtime })),
    ...over,
  }
}

const post = (body: unknown, userId = 'u-1') =>
  new Request('http://app/api/pipelines/python-test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user': userId },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('testRunRequestError', () => {
  it('accepts a bounded sample', () => {
    expect(testRunRequestError(good)).toBeNull()
    expect(
      testRunRequestError({
        ...good,
        inputs: { r: [], previous: [{ a: 1 }], answer: [] },
        requirements: ['numpy==2.2.6'],
        contract: { output: { columns: [{ name: 'v', type: 'integer' }] } },
      }),
    ).toBeNull()
  })

  it.each([
    ['no code', { ...good, statement: '  ' }],
    ['code over the limit', { ...good, statement: 'x'.repeat(20_001) }],
    ['a bad input name', { ...good, inputs: { 'Bad Name': [] } }],
    ['rows that are not objects', { ...good, inputs: { r: [1] } }],
    ['too many rows', { ...good, inputs: { r: Array(1_001).fill({ a: 1 }) } }],
    [
      'too many cells',
      {
        ...good,
        inputs: {
          r: Array(600).fill(
            Object.fromEntries(
              Array.from({ length: 100 }, (_, i) => [`c${i}`, i]),
            ),
          ),
        },
      },
    ],
    ['parameters that are a list', { ...good, parameters: [] }],
    ['an unpinned requirement', { ...good, requirements: ['numpy'] }],
    ['a malformed contract', { ...good, contract: { output: { columns: 3 } } }],
  ])('refuses %s', (_label, body) => {
    expect(testRunRequestError(body)).toEqual(expect.any(String))
  })
})

describe('handlePythonTestRun', () => {
  it('runs the step and returns rows, columns, logs and timing', async () => {
    let tick = 1_000
    const execute = vi.fn(async (_input: ExecuteInput) => ({
      rows: [{ n: 1, day: '2026-01-01' }],
      logs: ['hello'],
      runtime,
      environment: { python: '3.12.8', packages: {} },
    }))
    const response = await handlePythonTestRun(
      post({ ...good, requirements: ['numpy==2.2.6'] }),
      deps({ execute, now: () => (tick += 40) }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      rows: [{ n: 1, day: '2026-01-01' }],
      rowCount: 1,
      truncated: false,
      columns: [
        { name: 'n', type: 'integer', nullable: false },
        { name: 'day', type: 'date', nullable: false },
      ],
      logs: ['hello'],
      runtime,
      durationMs: 40,
    })
    // No artefact key: a test run keeps no files.
    expect(execute.mock.calls[0][0]).not.toHaveProperty('artefactKey')
    expect(execute.mock.calls[0][0]).toMatchObject({
      requirements: ['numpy==2.2.6'],
    })
  })

  it('echoes a bounded number of rows and says how many there were', async () => {
    const rows = Array.from({ length: TEST_RESULT_ROWS + 50 }, (_, i) => ({
      i,
    }))
    const response = await handlePythonTestRun(
      post(good),
      deps({ execute: async () => ({ rows, logs: [], runtime }) }),
    )
    const body = (await response.json()) as {
      rows: unknown[]
      rowCount: number
      truncated: boolean
    }
    expect(body.rows).toHaveLength(TEST_RESULT_ROWS)
    expect(body.rowCount).toBe(TEST_RESULT_ROWS + 50)
    expect(body.truncated).toBe(true)
  })

  it('returns a failing step as a result, with its logs and line', async () => {
    const response = await handlePythonTestRun(
      post(good),
      deps({
        execute: async () => {
          throw new PipelinePythonError('ValueError: bad', 'transform_failed', {
            logs: ['before'],
            line: 3,
          })
        },
      }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'ValueError: bad',
      code: 'transform_failed',
      logs: ['before'],
      line: 3,
    })
  })

  it('says so when no runner is connected', async () => {
    const response = await handlePythonTestRun(
      post(good),
      deps({
        execute: async () => {
          throw new PipelinePythonError('No runner.', 'runner_unavailable')
        },
      }),
    )
    expect(response.status).toBe(503)
  })

  it('needs a signed-in person who can edit their workspace', async () => {
    const execute = vi.fn()
    expect(
      (
        await handlePythonTestRun(
          post(good),
          deps({ getSession: async () => null, execute }),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await handlePythonTestRun(
          post(good),
          deps({ getWriterWorkspace: async () => null, execute }),
        )
      ).status,
    ).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it('refuses an invalid body before running anything', async () => {
    const execute = vi.fn()
    expect(
      (await handlePythonTestRun(post('{nope'), deps({ execute }))).status,
    ).toBe(400)
    expect(
      (
        await handlePythonTestRun(
          post({ ...good, requirements: ['numpy'] }),
          deps({ execute }),
        )
      ).status,
    ).toBe(400)
    expect(execute).not.toHaveBeenCalled()
  })

  it('limits how often one person can run tests', async () => {
    const d = deps({ getSession: async () => ({ user: { id: 'u-busy' } }) })
    let last = 200
    for (let i = 0; i < 25; i += 1)
      last = (await handlePythonTestRun(post(good), d)).status
    expect(last).toBe(429)
  })
})
