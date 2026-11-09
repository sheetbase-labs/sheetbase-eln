/** Trusted, single-purpose Docker broker. Never mount its socket in the app or job. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createEgressProxy } from './pipeline-python-egress.mjs'

/**
 * What a pipeline Python step gets. A plugin call carries its own `limits`
 * (set per plugin by an administrator) and those replace these for that call;
 * see `limitsOf`.
 */
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
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Bare-Node Docker broker must validate untrusted JSON without runtime dependencies.
  value !== null && typeof value === 'object' && !Array.isArray(value)

export class RunnerError extends Error {
  /**
   * `details` carries what a failed step leaves behind for its author: its own print
   * output (`logs`) and the line of its code the failure came from (`line`).
   */
  constructor(message, status = 422, code = 'transform_failed', details = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** A requirement is `name==version`: nothing the container could be talked into fetching. */
export const REQUIREMENT =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?==[A-Za-z0-9](?:[A-Za-z0-9.!+_-]*[A-Za-z0-9])?$/

const MAX_REQUIREMENTS = 50

/**
 * A plugin's package line, as pip is given it. This is the broker's own check,
 * not a copy of the app's: the lines are written to a requirements file and
 * installed with network access, so nothing that could be read as a pip option
 * or a second line gets through. Mirrors `requirementProblem` in
 * src/lib/extensions/runtime-config.ts (a test keeps them in step).
 */
const NAME = '[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?'
const EXTRAS = '(?:\\[[A-Za-z0-9](?:[A-Za-z0-9._,\\s-]*[A-Za-z0-9])?\\])?'
const CLAUSE = '(?:===|==|~=|!=|<=|>=|<|>)\\s*[A-Za-z0-9][A-Za-z0-9.*+!_-]*'
const VERSIONS = `(?:\\s*${CLAUSE}(?:\\s*,\\s*${CLAUSE})*)?`
const MARKER = '(?:\\s*;\\s*[A-Za-z0-9 _.\'"()<>=!~,-]+)?'

export const PLUGIN_REQUIREMENT = new RegExp(
  `^${NAME}${EXTRAS}(?:${VERSIONS}|\\s*@\\s*https://[^\\s;]+)${MARKER}$`,
)

export const PLUGIN_HOST =
  /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

export const ENVIRONMENT_ID = /^pe-[a-f0-9]{16}$/
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/

/** Log output a plugin call may keep. Not a setting: it only trims what is shown after a failure. */
const PLUGIN_LOG_BYTES = 1024 * 1024
const MIB = 1024 * 1024

const positive = (value) =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Decode untrusted resource limits before constructing Docker arguments in the dependency-free broker.
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * The limits one job runs with. A pipeline step has none of its own and gets
 * the fixed pipeline limits. A plugin call names its own, which replace them
 * entirely: rows and bytes bound the data, and the width of a row and the
 * number of cells follow from those.
 */
export function limitsOf(job) {
  const given = job.limits

  if (given === undefined)
    return {
      custom: false,
      bytes: LIMITS.bytes,
      rows: LIMITS.rows,
      fields: LIMITS.fields,
      cells: LIMITS.cells,
      logBytes: LIMITS.logBytes,
      timeoutMs: LIMITS.timeoutMs,
      memoryMb: 512,
      cpus: 1,
      processes: 64,
      scratchMb: 64,
    }

  return {
    custom: true,
    bytes: given.bytes,
    rows: given.rows,
    fields: Infinity,
    cells: Infinity,
    logBytes: PLUGIN_LOG_BYTES,
    timeoutMs: Math.round(given.timeoutSeconds * 1000),
    memoryMb: given.memoryMb,
    cpus: given.cpus,
    processes: given.processes,
    scratchMb: given.scratchMb,
  }
}

function validateLimits(given) {
  if (
    !isObject(given) ||
    ![
      'timeoutSeconds',
      'memoryMb',
      'cpus',
      'processes',
      'scratchMb',
      'bytes',
      'rows',
    ].every((key) => positive(given[key]))
  )
    throw new RunnerError(
      'The run limits must be positive numbers.',
      400,
      'invalid_configuration',
    )
}

/** Failure details from the worker, kept only when they are the shape and size we expect. */
export function failureDetails(result) {
  const details = {}

  if (
    Array.isArray(result.logs) &&
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Worker stdout is untrusted JSON; reject non-text logs without adding dependencies to the broker image.
    result.logs.every((line) => typeof line === 'string') &&
    Buffer.byteLength(result.logs.join('\n')) <= LIMITS.logBytes
  )
    details.logs = result.logs

  if (Number.isInteger(result.line) && result.line > 0)
    details.line = result.line

  return details
}

function validateRows(rows, limit = limitsOf({})) {
  if (!Array.isArray(rows) || rows.length > limit.rows)
    throw new RunnerError('Python row limit exceeded.')
  let cells = 0

  for (const row of rows) {
    if (!isObject(row))
      throw new RunnerError('Python results must contain row objects.')
    const fields = Object.keys(row).length
    cells += fields

    if (fields > limit.fields || cells > limit.cells)
      throw new RunnerError('Python field or cell limit exceeded.')
  }

  return cells
}

export function validateJob(job) {
  if (isObject(job) && job.limits !== undefined) validateLimits(job.limits)
  const limit = limitsOf(isObject(job) ? job : {})

  if (
    !isObject(job) ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate HTTP JSON code before passing it to the dependency-free Python worker broker.
    typeof job.statement !== 'string' ||
    !job.statement.trim() ||
    // A pipeline step is a few lines. A plugin's files travel inside its steps
    // and are bounded by the plugin's own data limit instead.
    (!limit.custom && job.statement.length > 128_000) ||
    !isObject(job.inputs) ||
    !isObject(job.parameters)
  ) {
    throw new RunnerError(
      'Provide Python code, named input rows and parameters.',
      400,
      'invalid_configuration',
    )
  }

  if (job.mode !== undefined)
    throw new RunnerError('Unknown job option.', 400, 'invalid_configuration')

  if (
    job.environment !== undefined &&
    (!limit.custom ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Untrusted environment IDs must be strings before regex validation in the bare-Node broker.
      typeof job.environment !== 'string' ||
      !ENVIRONMENT_ID.test(job.environment))
  )
    throw new RunnerError(
      'The package environment is not a valid name.',
      400,
      'invalid_configuration',
    )

  if (
    job.network !== undefined &&
    (!limit.custom ||
      !Array.isArray(job.network) ||
      job.network.some(
        (host) =>
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Reject non-string approved hosts from HTTP JSON before sandbox network setup; broker image has no dependencies.
          typeof host !== 'string' ||
          host.length > 253 ||
          !PLUGIN_HOST.test(host),
      ))
  )
    throw new RunnerError(
      'The approved hosts must be host names.',
      400,
      'invalid_configuration',
    )

  if (
    job.requirements !== undefined &&
    (!Array.isArray(job.requirements) ||
      job.requirements.length > MAX_REQUIREMENTS ||
      job.requirements.some(
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Reject non-string package requirements at the HTTP boundary in the dependency-free broker.
        (line) => typeof line !== 'string' || !REQUIREMENT.test(line),
      ))
  )
    throw new RunnerError(
      'Requirements must be pinned as name==version.',
      400,
      'invalid_configuration',
    )

  if (job.contract !== undefined && !isObject(job.contract))
    throw new RunnerError(
      'The data contract must be an object.',
      400,
      'invalid_configuration',
    )
  let count = 0
  let cells = 0

  for (const rows of Object.values(job.inputs)) {
    cells += validateRows(rows, limit)
    count += rows.length
  }

  if (count > limit.rows || cells > limit.cells)
    throw new RunnerError(
      'Python input exceeds row or cell limit.',
      413,
      'input_too_large',
    )
}

export function validateResult(result, limit = limitsOf({})) {
  if (!isObject(result))
    throw new RunnerError('Python returned an invalid response.')
  validateRows(result.rows, limit)

  if (
    !Array.isArray(result.logs) ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate worker stdout before returning logs; the bare-Node runner image has no schema library.
    result.logs.some((line) => typeof line !== 'string') ||
    Buffer.byteLength(result.logs.join('\n')) > limit.logBytes
  ) {
    throw new RunnerError('Python log output exceeds its limit.')
  }
}

export function containerArguments(image, name, options = {}) {
  if (!DIGEST_IMAGE.test(image) && !IMAGE_ID.test(image))
    throw new RunnerError(
      'Configure a digest-pinned Python image.',
      503,
      'runner_unavailable',
    )
  const limit = options.limits ?? limitsOf({})
  const threads = String(Math.max(1, Math.ceil(limit.cpus)))
  const egress = options.egress

  return [
    'create',
    '--name',
    name,
    '--label',
    'uk.co.sheetbase.pipeline-python=true',
    '--pull=never',
    // No route anywhere, unless the plugin's approved hosts put it on the
    // private network whose only other member is this runner's allow-listing proxy.
    `--network=${egress ? egress.network : 'none'}`,
    '--read-only',
    '--user=65532:65532',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges=true',
    `--pids-limit=${limit.processes}`,
    `--memory=${limit.memoryMb}m`,
    `--memory-swap=${limit.memoryMb}m`,
    `--cpus=${limit.cpus}`,
    '--ipc=none',
    `--ulimit=nofile=${limit.custom ? 4096 : 256}:${limit.custom ? 4096 : 256}`,
    `--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=${limit.scratchMb}m,mode=1777`,
    '--log-driver=none',
    '--interactive',
    '--workdir=/tmp',
    '--entrypoint=python',
    `--env=OPENBLAS_NUM_THREADS=${threads}`,
    `--env=OMP_NUM_THREADS=${threads}`,
    `--env=MKL_NUM_THREADS=${threads}`,
    // The worker reads at most what this call was allowed to send.
    `--env=SHEETBASE_MAX_INPUT_BYTES=${limit.bytes}`,
    ...(egress
      ? ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].map(
          (variable) => `--env=${variable}=${egress.url}`,
        )
      : []),
    image,
    '-I',
    '-u',
    '/opt/sheetbase/worker.py',
  ]
}

/** No shell interpolation; fixed executable, fixed args, no caller-selected mounts/env. */
function docker(
  args,
  {
    input = '',
    timeoutMs = 10_000,
    maxBytes = LIMITS.bytes,
    timeoutMessage = 'Python execution timed out.',
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    let size = 0
    let failure = null

    const timer = setTimeout(() => {
      failure = new RunnerError(timeoutMessage, 504, 'transform_timed_out')
      child.kill('SIGKILL')
    }, timeoutMs)

    const collect = (chunk, stdout) => {
      size += chunk.length

      if (size > maxBytes) {
        failure = new RunnerError(
          `Python output exceeds ${Math.round(maxBytes / MIB)} MiB.`,
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
  // The key is the run, and a run can have several Python steps, so the directory is
  // created once and each step's files accumulate in it. Clearing it here would make a
  // second step's output replace the first's.
  const destination = join(artefactRoot(), artefactKey)
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
export async function pruneArtefacts(
  maxAgeMs = ARTEFACT_TTL_MS,
  now = Date.now(),
) {
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

/** The interpreter and declared-package versions the worker reports, or nothing if malformed. */
function reportedEnvironment(value) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Decode the untrusted worker's interpreter identity without dependencies in the standalone Docker broker.
  if (!isObject(value) || typeof value.python !== 'string') return undefined

  if (!isObject(value.packages)) return undefined
  const packages = {}

  for (const [name, version] of Object.entries(value.packages)) {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Decode the untrusted worker's package versions in the dependency-free broker image.
    if (typeof version !== 'string') return undefined
    packages[name] = version
  }

  return { python: value.python.slice(0, 32), packages }
}

/**
 * What the pinned image contains: interpreter version and installed packages.
 *
 * Asked of the same hardened container a job runs in (no network, read-only root), so the
 * answer is what a step would actually see. An unreadable answer is not fatal: the runtime
 * identity alone is still enough to pin a version.
 */
export async function inspectRuntime(image, command = docker) {
  const name = `sheetbase-python-inspect-${randomUUID()}`

  try {
    const created = await command(containerArguments(image, name))

    if (created.code !== 0) return undefined

    const completed = await command(
      ['start', '--attach', '--interactive', name],
      { input: JSON.stringify({ mode: 'inspect' }), timeoutMs: 20_000 },
    )

    return completed.code === 0
      ? reportedEnvironment(JSON.parse(completed.stdout).environment)
      : undefined
  } catch {
    return undefined
  } finally {
    await command(['rm', '--force', name]).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Per-plugin package environments.
// ---------------------------------------------------------------------------

const ENVIRONMENT_REPOSITORY = 'sheetbase-plugin-env'
const ENVIRONMENT_LABEL = 'uk.co.sheetbase.plugin-environment=true'

/** How long installing one plugin's packages may take. Raise it for packages that compile. */
const buildTimeoutMs = () =>
  Number(process.env.PIPELINE_PYTHON_BUILD_TIMEOUT_MINUTES ?? 60) * 60_000

/**
 * The name of the environment for a list of packages on a base image. The same
 * packages on the same image are the same environment, so plugins that need
 * the same things share one build and a changed base image rebuilds.
 */
export function environmentId(baseImage, requirements) {
  const lines = requirements.map((line) => line.trim()).sort()

  return `pe-${createHash('sha256')
    .update(`${baseImage}\n${lines.join('\n')}`)
    .digest('hex')
    .slice(0, 16)}`
}

export function validateRequirements(requirements) {
  if (
    !Array.isArray(requirements) ||
    requirements.length === 0 ||
    requirements.some(
      (line) =>
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate untrusted pip lines before network-enabled installation; broker image has no schema dependency.
        typeof line !== 'string' ||
        line.length > 300 ||
        line.startsWith('-') ||
        !PLUGIN_REQUIREMENT.test(line.trim()),
    )
  )
    throw new RunnerError(
      'Give the packages as pip requirement lines such as rdkit>=2024.3.',
      400,
      'invalid_configuration',
    )
}

/** The Dockerfile for an environment: the worker image plus the plugin's packages. */
export function environmentDockerfile({ pipIndexUrl } = {}) {
  return [
    'ARG BASE',
    'FROM ${BASE}',
    ...(pipIndexUrl ? ['ARG PIP_INDEX_URL'] : []),
    'USER root',
    'COPY requirements.txt /tmp/plugin-requirements.txt',
    'RUN pip install --no-cache-dir -r /tmp/plugin-requirements.txt && rm /tmp/plugin-requirements.txt',
    'USER 65532:65532',
    '',
  ].join('\n')
}

/** The image a built environment runs from, or nothing when it hasn't been built. */
export async function environmentImage(id, command = docker) {
  const found = await command([
    'image',
    'inspect',
    '--format={{.Id}}',
    `${ENVIRONMENT_REPOSITORY}:${id}`,
  ]).catch(() => ({ code: 1, stdout: '' }))

  const imageId = found.stdout.trim()

  if (found.code !== 0 || !IMAGE_ID.test(imageId)) return undefined

  return {
    id: imageId,
    // Reported to the app as the runtime that ran the call.
    reported: `${ENVIRONMENT_REPOSITORY}@${imageId}`,
  }
}

/** Last lines of the installer's output: what the administrator needs to read. */
export function buildFailureMessage(output) {
  const lines = output
    .split('\n')
    .map((line) => line.replace(/^#\d+\s+[\d.]+\s/, '').trim())
    .filter(Boolean)

  const error = lines.findLastIndex((line) =>
    /error|failed|no matching/i.test(line),
  )

  const picked = lines.slice(
    Math.max(0, (error === -1 ? lines.length - 1 : error) - 3),
    error === -1 ? lines.length : error + 4,
  )

  return (
    picked.join('\n').slice(-1500) || 'The packages could not be installed.'
  )
}

/**
 * Builds the environment image for a package list. Runs with network access
 * (the only place anything is fetched), once per distinct list, on an image
 * that already holds the worker.
 */
export async function buildEnvironment(
  requirements,
  baseImage,
  command = docker,
  { pipIndexUrl = process.env.PIPELINE_PYTHON_PIP_INDEX_URL } = {},
) {
  validateRequirements(requirements)

  if (!DIGEST_IMAGE.test(baseImage))
    throw new RunnerError(
      'Configure a digest-pinned Python image.',
      503,
      'runner_unavailable',
    )
  const id = environmentId(baseImage, requirements)
  const folder = await mkdtemp(join(tmpdir(), 'sheetbase-plugin-env-'))

  try {
    await writeFile(
      join(folder, 'requirements.txt'),
      `${requirements.map((line) => line.trim()).join('\n')}\n`,
    )
    await writeFile(
      join(folder, 'Dockerfile'),
      environmentDockerfile({ pipIndexUrl }),
    )

    const built = await command(
      [
        'build',
        '--pull=false',
        '--tag',
        `${ENVIRONMENT_REPOSITORY}:${id}`,
        '--label',
        ENVIRONMENT_LABEL,
        '--build-arg',
        `BASE=${baseImage}`,
        ...(pipIndexUrl ? ['--build-arg', `PIP_INDEX_URL=${pipIndexUrl}`] : []),
        folder,
      ],
      {
        timeoutMs: buildTimeoutMs(),
        maxBytes: 256 * MIB,
        timeoutMessage:
          'Installing the packages took too long. An administrator can allow more time with PIPELINE_PYTHON_BUILD_TIMEOUT_MINUTES on the runner.',
      },
    )

    if (built.code !== 0)
      throw new RunnerError(
        buildFailureMessage(`${built.stderr}\n${built.stdout}`),
        422,
        'environment_failed',
      )

    return id
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

/**
 * Tracks builds for the HTTP API. One build at a time (they are heavy), keyed
 * by environment id; what is built survives a restart because it is an image.
 */
export function createEnvironments({ image, command = docker, inspect }) {
  const builds = new Map()
  let queue = Promise.resolve()

  const packagesOf = async (id) => {
    const built = await environmentImage(id, command)

    return built ? await inspect(built.id).catch(() => undefined) : undefined
  }

  return {
    id: (requirements) => environmentId(image, requirements),
    async status(id) {
      if (!ENVIRONMENT_ID.test(id))
        throw new RunnerError('Unknown environment.', 404, 'not_found')
      const building = builds.get(id)

      if (building?.state === 'building') return { id, state: 'building' }

      if (await environmentImage(id, command)) {
        const environment = await packagesOf(id)

        return {
          id,
          state: 'ready',
          packages: environment?.packages,
        }
      }

      if (building) return { id, state: building.state, error: building.error }

      return { id, state: 'missing' }
    },
    /** Starts a build unless the environment exists or is being built. */
    async ensure(requirements) {
      validateRequirements(requirements)
      const id = environmentId(image, requirements)
      const current = await this.status(id)

      if (current.state === 'ready' || current.state === 'building')
        return current
      builds.set(id, { state: 'building' })
      queue = queue.then(async () => {
        try {
          await buildEnvironment(requirements, image, command)
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
    /** Resolves when every started build has finished (tests, shutdown). */
    idle: () => queue,
  }
}

/**
 * Where plugin containers get their network from, when an administrator has
 * approved hosts for a plugin: a private Docker network the runner is also on,
 * and the allow-listing proxy the runner serves on it.
 */
export function egressFromEnvironment(env = process.env) {
  const network = env.PIPELINE_PYTHON_EGRESS_NETWORK
  const host = env.PIPELINE_PYTHON_EGRESS_HOST

  if (!network || !host) return undefined

  return {
    network,
    host,
    port: Number(env.PIPELINE_PYTHON_EGRESS_PORT ?? 3128),
    allowPrivate: env.PIPELINE_PYTHON_EGRESS_ALLOW_PRIVATE === '1',
  }
}

export async function runDockerJob(job, image, command = docker, context = {}) {
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
    throw new RunnerError(
      `Python input exceeds ${Math.round(limit.bytes / MIB)} MiB.`,
      413,
      'input_too_large',
    )
  // A plugin with its own packages runs in the image built for them.
  let runImage = image
  let reported = image

  if (job.environment !== undefined) {
    const built = await environmentImage(job.environment, command)

    if (!built)
      throw new RunnerError(
        'This plugin’s packages are not installed on the runner yet.',
        409,
        'environment_not_ready',
      )
    runImage = built.id
    reported = built.reported
  }

  // Approved hosts: one credential for this call, on the private network.
  let grant
  let egress

  if (job.network && job.network.length > 0) {
    if (!context.egress || !context.proxy)
      throw new RunnerError(
        'This runner is not set up to give plugins network access. An administrator needs to configure the egress network.',
        503,
        'network_unavailable',
      )
    grant = context.proxy.register(job.network)
    egress = {
      network: context.egress.network,
      url: `http://job:${grant.token}@${context.egress.host}:${context.egress.port}`,
    }
  }

  const name = `sheetbase-python-${randomUUID()}`
  const args = containerArguments(runImage, name, { limits: limit, egress })

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
      {
        input,
        timeoutMs: limit.timeoutMs,
        // The answer, its logs and a little framing.
        maxBytes: limit.bytes + limit.logBytes + MIB,
        timeoutMessage: limit.custom
          ? `Python execution timed out after ${Math.round(limit.timeoutMs / 1000)} seconds. An administrator can allow this plugin more time in Settings → Plugins.`
          : 'Python execution timed out.',
      },
    )

    let result

    try {
      result = JSON.parse(completed.stdout)
    } catch {
      throw new RunnerError(
        limit.custom
          ? 'The plugin stopped without an answer. It may have run out of memory or processes; an administrator can raise its limits in Settings → Plugins.'
          : 'Python exited without a valid result. Check the code and resource limits.',
      )
    }

    if (completed.code !== 0 || result.error)
      throw new RunnerError(
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Worker errors are untrusted JSON; only text may be displayed by this standalone broker.
        typeof result.error === 'string'
          ? result.error.slice(0, 2000)
          : 'Python execution failed.',
        422,
        'transform_failed',
        failureDetails(result),
      )
    validateResult(result, limit)

    // PIPE-04.1: a function may also return files; they are collected before the
    // container is removed, since a stopped container is only readable until then.
    const files = job.artefactKey
      ? await collectOutputFiles(command, name, job.artefactKey)
      : []

    const output = {
      rows: result.rows,
      logs: result.logs,
      runtime: reported,
      files: files.map((file) => ({ name: file.name, size: file.size })),
    }

    const environment = reportedEnvironment(result.environment)

    if (environment) output.environment = environment

    return output
  } finally {
    grant?.release()
    // Killing a Docker CLI process does not kill its container. Remove by our fixed name.
    await removeJobContainer(command, name)
  }
}

async function removeJobContainer(command, name) {
  const failed = () =>
    new RunnerError(
      'Python container cleanup failed. The runner requires administrator attention.',
      503,
      'cleanup_failed',
    )

  let removed

  try {
    removed = await command(['rm', '--force', name])
  } catch {
    throw failed()
  }

  if (
    removed.code !== 0 &&
    !removed.stderr?.includes(`No such container: ${name}`)
  )
    throw failed()
}

function authorized(header, token) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node HTTP headers may be absent or arrays; reject them before hashing credentials in the standalone broker.
  if (typeof header !== 'string') return false
  const hash = (value) => createHash('sha256').update(value).digest()

  return timingSafeEqual(hash(header), hash(`Bearer ${token}`))
}

export function createRunnerServer({
  token,
  image,
  execute = runDockerJob,
  inspect = inspectRuntime,
  /** Calls running at once. A pipeline step and a plugin call each count as one. */
  concurrency = Number(process.env.PIPELINE_PYTHON_RUNNER_CONCURRENCY ?? 4),
  /** Largest request the runner will read at all. A plugin's own data limit applies inside it. */
  maxBodyBytes = Number(process.env.PIPELINE_PYTHON_RUNNER_MAX_BODY_MB ?? 512) *
    MIB,
  egress = egressFromEnvironment(),
  proxy = egress
    ? createEgressProxy({ allowPrivate: egress.allowPrivate })
    : undefined,
  environments = createEnvironments({
    image,
    inspect: (id) => inspectRuntime(id),
  }),
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
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Validate operator configuration before enabling the dependency-free broker's HTTP listener.
    typeof token !== 'string' ||
    token.length < 32 ||
    !DIGEST_IMAGE.test(image ?? '')
  )
    throw new Error(
      'Configure a runner token of at least 32 characters and a digest-pinned Python image.',
    )
  let active = 0
  let cleanupFailed = false
  // The image is immutable, so what it contains is asked once and remembered.
  let inspected

  const environmentOf = () => {
    inspected ??= inspect(image).then((environment) => {
      if (!environment) inspected = undefined

      return environment
    })

    return inspected
  }

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

      const environmentRoute = /^\/environments\/([a-z0-9-]+)$/.exec(
        request.url ?? '',
      )

      if (!(
        (request.method === 'POST' && request.url === '/execute') ||
        (request.method === 'POST' && request.url === '/artefacts/release') ||
        (request.method === 'POST' && request.url === '/environments') ||
        (request.method === 'GET' && environmentRoute) ||
        (request.method === 'GET' && request.url === '/runtime')
      ))
        return send(404, { error: 'Not found.' })

      if (!authorized(request.headers.authorization, token))
        return send(401, { error: 'Unauthorized.' })

      if (cleanupFailed)
        return send(503, {
          error: 'Python runner requires administrator attention.',
        })

      // The packages a plugin installs: asked for once per distinct list.
      if (request.url === '/environments' || environmentRoute) {
        try {
          if (environmentRoute)
            return send(200, await environments.status(environmentRoute[1]))
          const chunks = []

          for await (const chunk of request) chunks.push(chunk)
          let body

          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            throw new RunnerError(
              'Invalid JSON body.',
              400,
              'invalid_configuration',
            )
          }

          const current = await environments.ensure(body?.requirements)

          return send(current.state === 'ready' ? 200 : 202, current)
        } catch (error) {
          return send(error instanceof RunnerError ? error.status : 500, {
            error:
              error instanceof RunnerError ? error.message : 'Request failed.',
            code:
              error instanceof RunnerError ? error.code : 'runner_unavailable',
          })
        }
      }

      // PIPE-04.2: a run's artefacts are temporary unless it keeps them.
      if (request.url === '/artefacts/release') {
        const chunks = []

        for await (const chunk of request) chunks.push(chunk)
        let release

        try {
          release = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          return send(400, { error: 'Invalid JSON body.' })
        }

        if (
          !isObject(release) ||
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Artefact release is untrusted HTTP JSON in the dependency-free broker.
          typeof release.key !== 'string' ||
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Require an explicit boolean so malformed JSON cannot delete or retain artefacts by coercion.
          typeof release.keep !== 'boolean'
        )
          return send(400, {
            error: 'Provide an artefact key and whether to keep it.',
          })

        try {
          return send(200, await releaseArtefacts(release.key, release.keep))
        } catch (error) {
          return send(error instanceof RunnerError ? error.status : 500, {
            error: error instanceof Error ? error.message : 'Release failed.',
          })
        }
      }

      if (request.method === 'GET') {
        try {
          await checkRuntime()

          // The app waits 15 s for this answer: give the inspection less, and let a slow one
          // finish in the background for the next request.
          const environment = await Promise.race([
            environmentOf(),
            new Promise((resolve) => setTimeout(resolve, 8_000, undefined)),
          ])

          return send(200, {
            runtime: image,
            python: environment?.python,
            packages: environment?.packages,
          })
        } catch {
          return send(503, {
            error: 'The Python runtime image is not available.',
          })
        }
      }

      if (active >= concurrency)
        return send(503, {
          error: 'Python runner is unavailable. Try again later.',
        })

      if (request.headers['content-type']?.split(';')[0] !== 'application/json')
        return send(415, { error: 'Use application/json.' })

      if (Number(request.headers['content-length']) > maxBodyBytes)
        return send(413, {
          error: `Python input exceeds ${Math.round(maxBodyBytes / MIB)} MiB.`,
        })
      active++

      try {
        const chunks = []
        let size = 0

        for await (const chunk of request) {
          size += chunk.length

          if (size > maxBodyBytes)
            throw new RunnerError(
              `Python input exceeds ${Math.round(maxBodyBytes / MIB)} MiB.`,
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
        const limit = limitsOf(job)

        const result = await execute(job, image, undefined, {
          egress,
          proxy,
        })

        validateResult(result, limit)

        const payload = {
          rows: result.rows,
          logs: result.logs,
          runtime: result.runtime ?? image,
          environment: result.environment,
        }

        if (Buffer.byteLength(JSON.stringify(payload)) > limit.bytes)
          throw new RunnerError(
            `Python output exceeds ${Math.round(limit.bytes / MIB)} MiB.`,
          )
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
          logs: error instanceof RunnerError ? error.details.logs : undefined,
          line: error instanceof RunnerError ? error.details.line : undefined,
        })
      } finally {
        active--
      }
    },
  )

  // A call may run as long as its plugin's time limit allows, so the connection
  // is not cut at a fixed time: the job's own timeout ends it.
  server.requestTimeout = 0
  server.headersTimeout = 10_000
  server.timeout = 0

  if (proxy)
    server.on('listening', () => {
      proxy.server.listen(
        egress.port,
        process.env.PIPELINE_PYTHON_EGRESS_BIND ?? '0.0.0.0',
      )
    })
  server.on('close', () => proxy?.server.close())

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
