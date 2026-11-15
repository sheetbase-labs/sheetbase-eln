/**
 * The Docker-free runner: the same HTTP protocol, a child process per call.
 * Needs python3 with pandas (the worker's own requirement), as the runner tests do.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const hasPandas = spawnSync('python3', ['-c', 'import pandas']).status === 0
const TOKEN = 'a'.repeat(40)
let base = ''
let close = () => {}

beforeAll(async () => {
  process.env.PIPELINE_PYTHON_WORKER = resolve(
    'docker/pipeline-python/worker.py',
  )
  process.env.PIPELINE_PYTHON_EGRESS_PORT = '0'
  const { createDirectRunner } = await import('./pipeline-python-direct.mjs')
  const server = createDirectRunner({ token: TOKEN })

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  // SAFETY: listening on a TCP port, so address() is an AddressInfo.
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
})

afterAll(() => close())

const post = (path: string, body: object) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

describe('the Docker-free Python runner', () => {
  it.skipIf(!hasPandas)('runs a step as a child process', async () => {
    const response = await post('/execute', {
      statement:
        'def transform(inputs, parameters):\n    return [{"n": 2 + 2}]',
      inputs: {},
      parameters: {},
    })

    expect(response.status).toBe(200)
    expect((await response.json()).rows).toEqual([{ n: 4 }])
  })

  it('refuses a call without the token', async () => {
    const response = await fetch(`${base}/runtime`)

    expect(response.status).toBe(401)
  })

  it('says when a plugin’s packages are not installed yet', async () => {
    const response = await post('/execute', {
      statement: 'def transform(i, p):\n    return []',
      inputs: {},
      parameters: {},
      environment: 'pe-0123456789abcdef',
      limits: {
        timeoutSeconds: 30,
        memoryMb: 256,
        cpus: 1,
        processes: 32,
        scratchMb: 32,
        bytes: 1000000,
        rows: 10,
      },
    })

    expect(response.status).toBe(409)
  })
})
