/** Trusted, single-purpose Docker broker. Never mount its socket in the app or job. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  rows: 100_000,
  fields: 256,
  cells: 1_000_000,
  logBytes: 64 * 1024,
  timeoutMs: 60_000,
})
export const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export class RunnerError extends Error {
  constructor(message, status = 422, code = 'transform_failed') {
    super(message)
    this.status = status
    this.code = code
  }
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length > LIMITS.rows)
    throw new RunnerError('Python row limit exceeded.')
  let cells = 0
  for (const row of rows) {
    if (!isObject(row))
      throw new RunnerError('Python results must contain row objects.')
    const fields = Object.keys(row).length
    cells += fields
    if (fields > LIMITS.fields || cells > LIMITS.cells)
      throw new RunnerError('Python field or cell limit exceeded.')
  }
  return cells
}

export function validateJob(job) {
  if (
    !isObject(job) ||
    typeof job.statement !== 'string' ||
    !job.statement.trim() ||
    job.statement.length > 128_000 ||
    !isObject(job.inputs) ||
    !isObject(job.parameters)
  ) {
    throw new RunnerError(
      'Provide Python code, named input rows and parameters.',
      400,
      'invalid_configuration',
    )
  }
  let count = 0
  let cells = 0
  for (const rows of Object.values(job.inputs)) {
    cells += validateRows(rows)
    count += rows.length
  }
  if (count > LIMITS.rows || cells > LIMITS.cells)
    throw new RunnerError(
      'Python input exceeds row or cell limit.',
      413,
      'input_too_large',
    )
}

export function validateResult(result) {
  if (!isObject(result))
    throw new RunnerError('Python returned an invalid response.')
  validateRows(result.rows)
  if (
    !Array.isArray(result.logs) ||
    result.logs.some((line) => typeof line !== 'string') ||
    Buffer.byteLength(result.logs.join('\n')) > LIMITS.logBytes
  ) {
    throw new RunnerError('Python log output exceeds its limit.')
  }
}

export function containerArguments(image, name) {
  if (!DIGEST_IMAGE.test(image))
    throw new RunnerError(
      'Configure a digest-pinned Python image.',
      503,
      'runner_unavailable',
    )
  return [
    'create',
    '--name',
    name,
    '--label',
    'uk.co.sheetbase.pipeline-python=true',
    '--pull=never',
    '--network=none',
    '--read-only',
    '--user=65532:65532',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges=true',
    '--pids-limit=64',
    '--memory=512m',
    '--memory-swap=512m',
    '--cpus=1',
    '--ipc=none',
    '--ulimit=nofile=256:256',
    '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
    '--log-driver=none',
    '--interactive',
    '--workdir=/tmp',
    '--entrypoint=python',
    '--env=OPENBLAS_NUM_THREADS=1',
    '--env=OMP_NUM_THREADS=1',
    '--env=MKL_NUM_THREADS=1',
    image,
    '-I',
    '-u',
    '/opt/sheetbase/worker.py',
  ]
}

/** No shell interpolation; fixed executable, fixed args, no caller-selected mounts/env. */
function docker(
  args,
  { input = '', timeoutMs = 10_000, maxBytes = LIMITS.bytes } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    let size = 0
    let failure = null
    const timer = setTimeout(() => {
      failure = new RunnerError(
        'Python execution timed out.',
        504,
        'transform_timed_out',
      )
      child.kill('SIGKILL')
    }, timeoutMs)
    const collect = (chunk, stdout) => {
      size += chunk.length
      if (size > maxBytes) {
        failure = new RunnerError(
          'Python output exceeds 32 MiB.',
          422,
          'output_too_large',
        )
        child.kill('SIGKILL')
      } else if (stdout) chunks.push(chunk)
      else errors.push(chunk)
    }
    child.stdout.on('data', (chunk) => collect(chunk, true))
    child.stderr.on('data', (chunk) => collect(chunk, false))
    child.stdin.on('error', () => {
      /* Early exits are reported by close. */
    })
    child.on('error', () => {
      clearTimeout(timer)
      reject(
        new RunnerError(
          'Python runner could not start Docker.',
          503,
          'runner_unavailable',
        ),
      )
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (failure) reject(failure)
      else
        resolve({
          code,
          stdout: Buffer.concat(chunks).toString('utf8'),
          stderr: Buffer.concat(errors).toString('utf8'),
        })
    })
    child.stdin.end(input)
  })
}

export async function runDockerJob(job, image, command = docker) {
  validateJob(job)
  if (job.runtime !== undefined && job.runtime !== image)
    throw new RunnerError(
      'The pinned Python runtime is not available on this runner.',
      409,
      'runtime_mismatch',
    )
  const input = JSON.stringify(job)
  if (Buffer.byteLength(input) > LIMITS.bytes)
    throw new RunnerError(
      'Python input exceeds 32 MiB.',
      413,
      'input_too_large',
    )
  const name = `sheetbase-python-${randomUUID()}`
  const args = containerArguments(image, name)
  try {
    const created = await command(args)
    if (created.code !== 0)
      throw new RunnerError(
        'Python runtime image is unavailable. Ask an administrator to configure the runner.',
        503,
        'runner_unavailable',
      )
    const completed = await command(
      ['start', '--attach', '--interactive', name],
      { input, timeoutMs: LIMITS.timeoutMs },
    )
    let result
    try {
      result = JSON.parse(completed.stdout)
    } catch {
      throw new RunnerError(
        'Python exited without a valid result. Check the code and resource limits.',
      )
    }
    if (completed.code !== 0 || result.error)
      throw new RunnerError(
        typeof result.error === 'string'
          ? result.error.slice(0, 2000)
          : 'Python execution failed.',
      )
    validateResult(result)
    return { rows: result.rows, logs: result.logs, runtime: image }
  } finally {
    // Killing a Docker CLI process does not kill its container. Remove by our fixed name.
    let removed
    try {
      removed = await command(['rm', '--force', name])
    } catch {
      throw new RunnerError(
        'Python container cleanup failed. The runner requires administrator attention.',
        503,
        'cleanup_failed',
      )
    }
    if (
      removed.code !== 0 &&
      !removed.stderr?.includes(`No such container: ${name}`)
    )
      throw new RunnerError(
        'Python container cleanup failed. The runner requires administrator attention.',
        503,
        'cleanup_failed',
      )
  }
}

function authorized(header, token) {
  if (typeof header !== 'string') return false
  const hash = (value) => createHash('sha256').update(value).digest()
  return timingSafeEqual(hash(header), hash(`Bearer ${token}`))
}

export function createRunnerServer({
  token,
  image,
  execute = runDockerJob,
  checkRuntime = async () => {
    const result = await docker(['image', 'inspect', '--format={{.Id}}', image])
    if (result.code !== 0)
      throw new RunnerError(
        'The Python runtime image is not installed.',
        503,
        'runner_unavailable',
      )
  },
}) {
  if (
    typeof token !== 'string' ||
    token.length < 32 ||
    !DIGEST_IMAGE.test(image ?? '')
  )
    throw new Error(
      'Configure a runner token of at least 32 characters and a digest-pinned Python image.',
    )
  let active = 0
  let cleanupFailed = false
  const server = createServer(
    { maxHeaderSize: 16 * 1024 },
    async (request, response) => {
      const send = (status, payload) => {
        if (response.destroyed) return
        response.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
        response.end(JSON.stringify(payload))
      }
      if (!(
        (request.method === 'POST' && request.url === '/execute') ||
        (request.method === 'GET' && request.url === '/runtime')
      ))
        return send(404, { error: 'Not found.' })
      if (!authorized(request.headers.authorization, token))
        return send(401, { error: 'Unauthorized.' })
      if (cleanupFailed)
        return send(503, {
          error: 'Python runner requires administrator attention.',
        })
      if (request.method === 'GET') {
        try {
          await checkRuntime()
          return send(200, { runtime: image })
        } catch {
          return send(503, {
            error: 'The Python runtime image is not available.',
          })
        }
      }
      if (active >= 2)
        return send(503, {
          error: 'Python runner is unavailable. Try again later.',
        })
      if (request.headers['content-type']?.split(';')[0] !== 'application/json')
        return send(415, { error: 'Use application/json.' })
      if (Number(request.headers['content-length']) > LIMITS.bytes)
        return send(413, { error: 'Python input exceeds 32 MiB.' })
      active++
      try {
        const chunks = []
        let size = 0
        for await (const chunk of request) {
          size += chunk.length
          if (size > LIMITS.bytes)
            throw new RunnerError(
              'Python input exceeds 32 MiB.',
              413,
              'input_too_large',
            )
          chunks.push(chunk)
        }
        let job
        try {
          job = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          throw new RunnerError(
            'Invalid JSON job.',
            400,
            'invalid_configuration',
          )
        }
        validateJob(job)
        const result = await execute(job, image)
        validateResult(result)
        const payload = { rows: result.rows, logs: result.logs, runtime: image }
        if (Buffer.byteLength(JSON.stringify(payload)) > LIMITS.bytes)
          throw new RunnerError('Python output exceeds 32 MiB.')
        send(200, payload)
      } catch (error) {
        if (error instanceof RunnerError && error.code === 'cleanup_failed')
          cleanupFailed = true
        send(error instanceof RunnerError ? error.status : 500, {
          error:
            error instanceof RunnerError
              ? error.message
              : 'Python runner failed.',
          code:
            error instanceof RunnerError ? error.code : 'runner_unavailable',
        })
      } finally {
        active--
      }
    },
  )
  server.requestTimeout = 90_000
  server.headersTimeout = 10_000
  server.timeout = 95_000
  return server
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createRunnerServer({
    token: process.env.PIPELINE_PYTHON_RUNNER_TOKEN,
    image: process.env.PIPELINE_PYTHON_IMAGE,
  })
  server.listen(
    Number(process.env.PIPELINE_PYTHON_RUNNER_PORT ?? 8080),
    process.env.PIPELINE_PYTHON_RUNNER_HOST ?? '0.0.0.0',
  )
}
