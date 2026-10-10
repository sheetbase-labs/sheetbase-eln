/** Trusted, single-purpose Docker broker. Never mount its socket in the app or job. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  rows: 100_000,
  fields: 256,
  cells: 1_000_000,
  logBytes: 64 * 1024,
  timeoutMs: 60_000,
  // PIPE-04.1: a function may return files, within bounds it can plan against.
  files: 20,
  fileBytes: 8 * 1024 * 1024,
})

/**
 * PIPE-04.1 — the declared output directory a function writes files to.
 *
 * The container's only writable path is this tmpfs (the root is read-only), so a figure or
 * table a function produces has to land here. The runner collects it after the run and
 * reports each file with its size; what it does with the bytes is the artefact store's job
 * (PIPE-04.2).
 */
export const OUTPUT_DIR = '/tmp/out'

/**
 * Where collected artefacts are kept on this host, per run. Read per call rather than at
 * module load, so a deployment (or a test) can point it somewhere else without a restart.
 */
const artefactRoot = () =>
  process.env.SHEETBASE_ARTEFACT_DIR ?? '/tmp/sheetbase-artefacts'

/** Marks a run's artefacts as kept, so pruning leaves them alone. */
const KEEP_MARKER = '.keep'

/** How long an unkept artefact directory may sit before pruning removes it. */
const ARTEFACT_TTL_MS = 24 * 60 * 60 * 1000

/** A run key becomes a directory name, so it must not be able to escape the root. */
export const ARTEFACT_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/
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

/**
 * PIPE-04.1 — collect the files a function wrote to the declared output directory.
 *
 * `docker cp` reads a stopped container's filesystem, which is why this runs after the
 * container exits and before it is removed. The bytes land under a per-run directory on this
 * host; the response carries each file's name and size, never its contents, so a large figure
 * does not travel through the run's JSON result.
 *
 * A run that exceeds the bounds is refused rather than truncated: half a figure is worse than
 * a clear refusal, and the function can be told what the limits are.
 */
export async function collectOutputFiles(command, name, artefactKey) {
  if (!ARTEFACT_KEY.test(artefactKey))
    throw new RunnerError('Invalid artefact key.', 400, 'invalid_configuration')
  const destination = join(artefactRoot(), artefactKey)
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })

  // A container that wrote nothing has no directory; that is not a failure.
  const copied = await command(['cp', `${name}:${OUTPUT_DIR}/.`, destination])
  if (copied.code !== 0) return []

  const entries = await readdir(destination, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile())
  if (files.length > LIMITS.files)
    throw new RunnerError(
      `The function returned ${files.length} files, over the ${LIMITS.files}-file limit.`,
      422,
      'output_too_large',
    )
  let total = 0
  const collected = []
  for (const entry of files) {
    const path = join(destination, entry.name)
    const stats = await stat(path)
    total += stats.size
    if (total > LIMITS.fileBytes)
      throw new RunnerError(
        `The function returned ${(total / (1024 * 1024)).toFixed(1)} MiB of files, over the ${(LIMITS.fileBytes / (1024 * 1024)).toFixed(1)} MiB limit.`,
        422,
        'output_too_large',
      )
    collected.push({ name: entry.name, size: stats.size, path })
  }
  return collected.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * PIPE-04.2 — a run's artefacts are temporary unless it keeps them.
 *
 * They live under a per-run directory on this host, so releasing a run either deletes them or
 * marks the directory as kept. Kept artefacts outlive the run because a proposal can reference
 * one (PIPE-03), so the marker is a file rather than a database row: the runner owns the
 * bytes, and a marker next to them cannot drift from what is actually there.
 *
 * A run that dies before releasing leaves its directory behind, which is what pruning is for:
 * anything older than the window that was never kept is abandoned, not kept by accident.
 */
export async function releaseArtefacts(artefactKey, keep) {
  if (!ARTEFACT_KEY.test(artefactKey))
    throw new RunnerError('Invalid artefact key.', 400, 'invalid_configuration')
  const directory = join(artefactRoot(), artefactKey)
  if (keep) {
    await writeFile(join(directory, KEEP_MARKER), new Date().toISOString())
    return { kept: true }
  }
  await rm(directory, { recursive: true, force: true })
  return { kept: false }
}

/** Delete unkept artefact directories older than the window. */
export async function pruneArtefacts(maxAgeMs = ARTEFACT_TTL_MS, now = Date.now()) {
  let removed = 0
  let kept = 0
  let entries
  try {
    entries = await readdir(artefactRoot(), { withFileTypes: true })
  } catch {
    return { removed, kept }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directory = join(artefactRoot(), entry.name)
    const marker = await stat(join(directory, KEEP_MARKER)).catch(() => null)
    if (marker) {
      kept += 1
      continue
    }
    const directoryStat = await stat(directory).catch(() => null)
    if (!directoryStat) continue
    if (now - directoryStat.mtimeMs < maxAgeMs) continue
    await rm(directory, { recursive: true, force: true })
    removed += 1
  }
  return { removed, kept }
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
    // PIPE-04.1: a function may also return files; they are collected before the
    // container is removed, since a stopped container is only readable until then.
    const files = job.artefactKey
      ? await collectOutputFiles(command, name, job.artefactKey)
      : []
    return {
      rows: result.rows,
      logs: result.logs,
      runtime: image,
      files: files.map((file) => ({ name: file.name, size: file.size })),
    }
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
