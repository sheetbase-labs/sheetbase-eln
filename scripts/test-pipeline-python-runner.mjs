import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import {
  containerArguments,
  createRunnerServer,
  LIMITS,
  runDockerJob,
  RunnerError,
  validateJob,
  validateResult,
} from './pipeline-python-runner.mjs'

const image = `ghcr.io/example/python@sha256:${'a'.repeat(64)}`
const job = {
  statement: 'def transform(inputs, parameters): return []',
  inputs: {},
  parameters: {},
}

test('container boundary cannot accept caller-selected executable, network, mounts or privilege', () => {
  const args = containerArguments(image, 'fixture')
  for (const flag of [
    '--network=none',
    '--read-only',
    '--user=65532:65532',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges=true',
    '--pids-limit=64',
    '--memory=512m',
    '--memory-swap=512m',
    '--cpus=1',
    '--pull=never',
  ])
    assert.ok(args.includes(flag), flag)
  assert.ok(
    !args.some(
      (arg) => arg.startsWith('--volume') || arg.startsWith('--mount'),
    ),
  )
  assert.equal(args.at(-1), '/opt/sheetbase/worker.py')
  assert.throws(
    () => containerArguments('python:latest', 'fixture'),
    /digest-pinned/,
  )
})

test('always removes container after a timed-out attached Docker client', async () => {
  const calls = []
  const command = async (args) => {
    calls.push(args)
    if (args[0] === 'start')
      throw new RunnerError('timed out', 504, 'transform_timed_out')
    return { code: 0, stdout: '' }
  }
  await assert.rejects(runDockerJob(job, image, command), /timed out/)
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['create', 'start', 'rm'],
  )
  assert.equal(calls[2][1], '--force')
  assert.equal(calls[2][2], calls[0][2])
})

test('passes code only on stdin and records trusted runtime identity', async () => {
  const calls = []
  const command = async (args, options) => {
    calls.push({ args, options })
    return {
      code: 0,
      stdout:
        args[0] === 'start'
          ? JSON.stringify({
              rows: [{ n: 3 }],
              logs: ['done'],
              runtime: 'forged',
            })
          : '',
    }
  }
  assert.deepEqual(await runDockerJob(job, image, command), {
    rows: [{ n: 3 }],
    logs: ['done'],
    runtime: image,
  })
  assert.equal(calls[1].options.input, JSON.stringify(job))
  assert.equal(calls[1].options.timeoutMs, 60_000)
  assert.ok(!calls[0].args.includes(job.statement))
})

test('row, field, cell and log limits fail instead of truncating evidence', () => {
  assert.throws(
    () =>
      validateJob({
        ...job,
        inputs: { a: Array(60_000).fill({}), b: Array(60_000).fill({}) },
      }),
    /row or cell/,
  )
  assert.throws(
    () =>
      validateResult({
        rows: [
          Object.fromEntries(
            Array.from({ length: 257 }, (_, i) => [`c${i}`, i]),
          ),
        ],
        logs: [],
      }),
    /field or cell/,
  )
  assert.throws(
    () => validateResult({ rows: [], logs: ['x'.repeat(LIMITS.logBytes + 1)] }),
    /log output/,
  )
})

test('HTTP endpoint rejects unauthorized/other routes and runs a correctly authenticated job', async () => {
  let calls = 0
  const token = 'test-token-'.repeat(4)
  const server = createRunnerServer({
    token,
    image,
    execute: async () => {
      calls++
      return { rows: [{ value: '1.25' }], logs: [] }
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal(
      (await fetch(`${url}/execute`, { method: 'POST' })).status,
      401,
    )
    assert.equal((await fetch(`${url}/other`)).status, 404)
    const response = await fetch(`${url}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(job),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      rows: [{ value: '1.25' }],
      logs: [],
      runtime: image,
    })
    assert.equal(calls, 1)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('expected image mismatch fails before creating any container', async () => {
  let calls = 0
  await assert.rejects(
    runDockerJob(
      { ...job, runtime: `other@sha256:${'b'.repeat(64)}` },
      image,
      async () => {
        calls++
      },
    ),
    /pinned Python runtime/,
  )
  assert.equal(calls, 0)
})

test('cleanup transport failures poison the runner, including runtime discovery', async () => {
  const token = 'test-token-'.repeat(4)
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const server = createRunnerServer({
    token,
    image,
    checkRuntime: async () => {},
    execute: async () => {
      throw new RunnerError('cleanup failed', 503, 'cleanup_failed')
    },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${url}/runtime`, { headers })).status, 200)
    assert.equal(
      (
        await fetch(`${url}/execute`, {
          method: 'POST',
          headers,
          body: JSON.stringify(job),
        })
      ).status,
      503,
    )
    assert.equal((await fetch(`${url}/runtime`, { headers })).status, 503)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
