/**
 * What the runner tells a step's author: its own logs and failing line when it
 * fails, the packages its image provides, and the environment a run used. It also
 * refuses a requirement it could be talked into fetching.
 */
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RunnerError,
  createRunnerServer,
  inspectRuntime,
  runDockerJob,
  validateJob,
} from './pipeline-python-runner.mjs'
import type { DockerCommand } from './pipeline-python-runner.mjs'

const IMAGE = `registry.example/sheetbase-python@sha256:${'b'.repeat(64)}`
const TOKEN = 'x'.repeat(40)
const job = {
  statement: 'def transform(i, p): return []',
  inputs: {},
  parameters: {},
}

/** A fake docker CLI: `start` answers with the worker's stdout. */
function docker(stdout: string, code = 0): DockerCommand {
  return vi.fn(async (args: string[]) => ({
    code: args[0] === 'start' ? code : 0,
    stdout: args[0] === 'start' ? stdout : '',
    stderr: '',
  }))
}

describe('validateJob', () => {
  it('accepts pinned requirements and an object contract', () => {
    expect(() =>
      validateJob({
        ...job,
        requirements: ['scipy==1.15.3', 'python-dateutil==2.9.0.post0'],
        contract: { output: { columns: [] } },
      }),
    ).not.toThrow()
  })

  it.each([
    ['a range', ['scipy>=1.0']],
    ['a URL', ['scipy @ https://example.com/x.whl']],
    ['an option', ['--index-url=https://example.com']],
    ['a non-string', [1]],
  ])('refuses %s as a requirement', (_label, requirements) => {
    expect(() => validateJob({ ...job, requirements })).toThrow(RunnerError)
  })

  it('refuses a caller-chosen worker mode and a malformed contract', () => {
    expect(() => validateJob({ ...job, mode: 'inspect' })).toThrow(RunnerError)
    expect(() => validateJob({ ...job, contract: [] })).toThrow(RunnerError)
  })
})

describe('runDockerJob', () => {
  it('keeps the logs and failing line of a step that failed', async () => {
    const command = docker(
      JSON.stringify({
        error: 'ZeroDivisionError: x',
        logs: ['a', 'b'],
        line: 7,
      }),
      1,
    )
    const error = await runDockerJob(job, IMAGE, command).catch(
      (cause: unknown) => cause,
    )
    expect(error).toBeInstanceOf(RunnerError)
    expect((error as RunnerError).details).toEqual({
      logs: ['a', 'b'],
      line: 7,
    })
  })

  it('drops failure details that are not the expected shape', async () => {
    const command = docker(
      JSON.stringify({ error: 'boom', logs: [1, 2], line: -3 }),
      1,
    )
    const error = (await runDockerJob(job, IMAGE, command).catch(
      (cause: unknown) => cause,
    )) as RunnerError
    expect(error.details).toEqual({})
  })

  it('returns the environment the step ran in', async () => {
    const command = docker(
      JSON.stringify({
        rows: [{ a: 1 }],
        logs: [],
        environment: { python: '3.12.8', packages: { numpy: '2.2.6' } },
      }),
    )
    const result = await runDockerJob(job, IMAGE, command)
    expect(result.environment).toEqual({
      python: '3.12.8',
      packages: { numpy: '2.2.6' },
    })
  })
})

describe('inspectRuntime', () => {
  it('reports the interpreter and packages from the image', async () => {
    const command = docker(
      JSON.stringify({
        environment: { python: '3.12.8', packages: { pandas: '2.2.3' } },
      }),
    )
    expect(await inspectRuntime(IMAGE, command)).toEqual({
      python: '3.12.8',
      packages: { pandas: '2.2.3' },
    })
  })

  it('answers nothing, not an error, when the image cannot be inspected', async () => {
    expect(await inspectRuntime(IMAGE, docker('not json'))).toBeUndefined()
  })
})

describe('runner server', () => {
  const servers: Array<ReturnType<typeof createRunnerServer>> = []
  afterEach(() => {
    for (const server of servers.splice(0)) server.close()
  })

  async function start(options: Parameters<typeof createRunnerServer>[0]) {
    const server = createRunnerServer(options)
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    return (path: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
      })
  }

  it('lists the installed packages with the runtime identity', async () => {
    const call = await start({
      token: TOKEN,
      image: IMAGE,
      checkRuntime: async () => undefined,
      inspect: async () => ({ python: '3.12.8', packages: { numpy: '2.2.6' } }),
    })
    const body = (await (await call('/runtime')).json()) as Record<
      string,
      unknown
    >
    expect(body).toEqual({
      runtime: IMAGE,
      python: '3.12.8',
      packages: { numpy: '2.2.6' },
    })
  })

  it('still answers with the identity when the packages cannot be read', async () => {
    const call = await start({
      token: TOKEN,
      image: IMAGE,
      checkRuntime: async () => undefined,
      inspect: async () => undefined,
    })
    expect(await (await call('/runtime')).json()).toEqual({ runtime: IMAGE })
  })

  it('returns the logs and line with a failed step', async () => {
    const call = await start({
      token: TOKEN,
      image: IMAGE,
      execute: async () => {
        throw new RunnerError('ValueError: bad', 422, 'transform_failed', {
          logs: ['loaded 3 rows'],
          line: 4,
        })
      },
    })
    const response = await call('/execute', {
      method: 'POST',
      body: JSON.stringify(job),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: 'ValueError: bad',
      logs: ['loaded 3 rows'],
      line: 4,
    })
  })

  it('returns the environment with a successful step', async () => {
    const call = await start({
      token: TOKEN,
      image: IMAGE,
      execute: async () => ({
        rows: [{ a: 1 }],
        logs: [],
        environment: { python: '3.12.8', packages: { scipy: '1.15.3' } },
      }),
    })
    const response = await call('/execute', {
      method: 'POST',
      body: JSON.stringify(job),
    })
    expect(await response.json()).toMatchObject({
      rows: [{ a: 1 }],
      environment: { python: '3.12.8', packages: { scipy: '1.15.3' } },
    })
  })
})
