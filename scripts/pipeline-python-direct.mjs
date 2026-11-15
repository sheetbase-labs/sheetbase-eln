#!/usr/bin/env node
/**
 * A Python runner for a host with no Docker (a Railway or Fly service, a
 * disposable demo). It speaks the same HTTP protocol as pipeline-python-runner.mjs
 * and runs the same worker.py, but WITHOUT container isolation: each call is a
 * child process, and a plugin's packages live in a virtual environment.
 *
 * Hosts a plugin may reach are enforced by the egress proxy for clients that
 * honour HTTPS_PROXY (urllib, requests, httpx do); raw sockets are not blocked.
 * Run it only as its own service that holds no secrets and no database access,
 * and only for a workspace whose administrators you trust with code. See
 * docs/operations/pipeline-python.md.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createEgressProxy } from './pipeline-python-egress.mjs'
import {
  ENVIRONMENT_ID,
  RunnerError,
  createRunnerServer,
  environmentId,
  failureDetails,
  limitsOf,
  validateJob,
  validateRequirements,
  validateResult,
} from './pipeline-python-runner.mjs'

const WORKER = process.env.PIPELINE_PYTHON_WORKER ?? '/opt/sheetbase/worker.py'
const PYTHON = process.env.PIPELINE_PYTHON_BIN ?? 'python3'
const ENV_DIR = process.env.PIPELINE_PYTHON_ENV_DIR ?? '/data/environments'
const PROXY_PORT = Number(process.env.PIPELINE_PYTHON_EGRESS_PORT ?? 3128)

/** Stands in for the image digest the container runner pins. */
export function directImage(
  version = process.env.PIPELINE_PYTHON_VERSION ?? 'python3',
) {
  return `direct/${'sheetbase-python'}@sha256:${createHash('sha256').update(version).digest('hex')}`
}

function run(
  command,
  args,
  { input, timeoutMs, env, maxBytes = 64 * 1024 * 1024 } = {},
) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH, HOME: '/tmp', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: '/tmp',
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, timeoutMs)
      : undefined

    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxBytes) stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk
    })
    child.on('error', () => resolve({ code: 127, stdout, stderr, timedOut }))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input ?? '')
  })
}

const venvPython = (id) => join(ENV_DIR, id, 'bin', 'python')

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  )

async function inspect(python) {
  const result = await run(python, ['-I', '-u', WORKER], {
    input: JSON.stringify({ mode: 'inspect' }),
    timeoutMs: 30_000,
  })

  try {
    return JSON.parse(result.stdout).environment
  } catch {
    return undefined
  }
}

export function createDirectEnvironments({ image }) {
  const builds = new Map()
  let queue = Promise.resolve()

  return {
    id: (requirements) => environmentId(image, requirements),
    async status(id) {
      if (!ENVIRONMENT_ID.test(id))
        throw new RunnerError('Unknown environment.', 404, 'not_found')
      const building = builds.get(id)

      if (building?.state === 'building') return { id, state: 'building' }

      if (await exists(join(ENV_DIR, id, 'ready'))) {
        const environment = await inspect(venvPython(id))

        return { id, state: 'ready', packages: environment?.packages }
      }

      if (building) return { id, state: building.state, error: building.error }

      return { id, state: 'missing' }
    },
    async ensure(requirements) {
      validateRequirements(requirements)
      const id = environmentId(image, requirements)
      const current = await this.status(id)

      if (current.state === 'ready' || current.state === 'building')
        return current
      builds.set(id, { state: 'building' })
      queue = queue.then(async () => {
        const dir = join(ENV_DIR, id)

        try {
          await rm(dir, { recursive: true, force: true })
          await mkdir(ENV_DIR, { recursive: true })

          // The base packages (numpy, pandas ...) stay visible to the plugin.
          const created = await run(
            PYTHON,
            ['-m', 'venv', '--system-site-packages', dir],
            { timeoutMs: 120_000 },
          )

          if (created.code !== 0) throw new Error(created.stderr)

          const installed = await run(
            join(dir, 'bin', 'pip'),
            [
              'install',
              '--no-input',
              '--disable-pip-version-check',
              '--only-binary=:all:',
              ...requirements.map((line) => line.trim()),
            ],
            { timeoutMs: 15 * 60_000 },
          )

          if (installed.code !== 0)
            throw new RunnerError(
              `The packages could not be installed: ${installed.stderr.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300)}`,
            )
          await run('touch', [join(dir, 'ready')])
          builds.delete(id)
        } catch (error) {
          builds.set(id, {
            state: 'failed',
            error:
              error instanceof RunnerError
                ? error.message
                : 'The packages could not be installed.',
          })
        }
      })

      return { id, state: 'building' }
    },
    idle: () => queue,
  }
}

export async function runDirectJob(job, image, _command, context = {}) {
  validateJob(job)
  const limit = limitsOf(job)

  if (job.runtime !== undefined && job.runtime !== image)
    throw new RunnerError(
      'The pinned Python runtime is not available on this runner.',
      409,
      'runtime_mismatch',
    )
  const input = JSON.stringify(job)

  if (Buffer.byteLength(input) > limit.bytes)
    throw new RunnerError('Python input is too large.', 413, 'input_too_large')
  let python = PYTHON

  if (job.environment !== undefined) {
    if (
      !ENVIRONMENT_ID.test(job.environment) ||
      !(await exists(join(ENV_DIR, job.environment, 'ready')))
    )
      throw new RunnerError(
        'This plugin’s packages are not installed on the runner yet.',
        409,
        'environment_not_ready',
      )
    python = venvPython(job.environment)
  }

  let grant
  const proxyEnv = {}

  if (job.network && job.network.length > 0) {
    grant = context.proxy.register(job.network)
    const url = `http://job:${grant.token}@127.0.0.1:${PROXY_PORT}`

    for (const name of [
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'http_proxy',
      'https_proxy',
    ])
      proxyEnv[name] = url
  }

  try {
    const threads = String(Math.max(1, Math.ceil(limit.cpus)))

    const completed = await run(python, ['-I', '-u', WORKER], {
      input,
      timeoutMs: limit.timeoutMs,
      maxBytes: limit.bytes + limit.logBytes,
      env: {
        ...proxyEnv,
        OPENBLAS_NUM_THREADS: threads,
        OMP_NUM_THREADS: threads,
        MKL_NUM_THREADS: threads,
        SHEETBASE_MAX_INPUT_BYTES: String(limit.bytes),
      },
    })

    if (completed.timedOut) throw new RunnerError('Python execution timed out.')
    let result

    try {
      result = JSON.parse(completed.stdout)
    } catch {
      throw new RunnerError('Python exited without a valid result.')
    }

    if (completed.code !== 0 || result.error)
      throw new RunnerError(
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The worker answers untrusted JSON; only text is shown.
        typeof result.error === 'string'
          ? result.error.slice(0, 2000)
          : 'Python execution failed.',
        422,
        'transform_failed',
        failureDetails(result),
      )
    validateResult(result, limit)

    return {
      rows: result.rows,
      logs: result.logs,
      files: [],
      runtime: job.environment ? `${image}+${job.environment}` : image,
      environment: result.environment,
    }
  } finally {
    grant?.release()
  }
}

export function createDirectRunner(options = {}) {
  const image = options.image ?? directImage()
  const proxy = createEgressProxy({ allowPrivate: false })

  const egress = {
    network: 'host',
    host: '127.0.0.1',
    port: PROXY_PORT,
    allowPrivate: false,
  }

  return createRunnerServer({
    token: options.token ?? process.env.PIPELINE_PYTHON_RUNNER_TOKEN,
    image,
    execute: (job, img, command, context) =>
      runDirectJob(job, img, command, { ...context, egress, proxy }),
    inspect: () => inspect(PYTHON),
    environments: createDirectEnvironments({ image }),
    checkRuntime: async () => {},
    egress,
    proxy,
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.env.PIPELINE_PYTHON_EGRESS_BIND ??= '127.0.0.1'
  const server = createDirectRunner()
  const emit = server.emit.bind(server)

  // The platform's health check needs one unauthenticated answer.
  server.emit = (event, ...args) => {
    if (event === 'request' && args[0].url === '/api/health/ready') {
      args[1].writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')

      return true
    }

    return emit(event, ...args)
  }

  server.listen(
    Number(process.env.PIPELINE_PYTHON_RUNNER_PORT ?? 8080),
    process.env.PIPELINE_PYTHON_RUNNER_HOST ?? '::',
  )
}
