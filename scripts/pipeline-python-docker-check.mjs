#!/usr/bin/env node
// Proves the Python plugin sandbox on a real Docker daemon (CI runs it; so can
// you, on any machine with Docker). It builds the worker and runner images,
// installs a plugin's packages (RDKit) into an environment image, and makes real
// sandboxed calls through the runner's HTTP API, checking that:
//   1. the limits a call names are applied to its container;
//   2. the egress proxy lets a call reach a host it declared and nothing else;
//   3. a call that uses the installed package returns its answer.
// Needs: docker, node 22+, and internet access (PyPI, a registry image).
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'

const run = (args, options = {}) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0 && !options.allowFailure)
    throw new Error(
      `docker ${args.slice(0, 3).join(' ')} failed:\n${result.stderr}${result.stdout}`.slice(
        -3000,
      ),
    )
  return result
}
const out = (args, options) => run(args, options).stdout.trim()

const suffix = randomBytes(3).toString('hex')
const names = {
  registry: `sbci-registry-${suffix}`,
  runner: `sbci-runner-${suffix}`,
  bridge: `sbci-net-${suffix}`,
  egress: `sbci-egress-${suffix}`,
}
const token = randomBytes(24).toString('hex')
const port = Number(process.env.RUNNER_PORT ?? 18080)
const registryPort = Number(process.env.REGISTRY_PORT ?? 15000)
const base = `http://127.0.0.1:${port}`

const passed = []
const check = (name, ok, detail = '') => {
  if (!ok) throw new Error(`FAILED: ${name}${detail ? `\n${detail}` : ''}`)
  passed.push(name)
  console.log(`ok  ${name}`)
}

const digestOf = (image) => {
  run(['pull', '--quiet', image])
  const id = out([
    'image',
    'inspect',
    '--format={{index .RepoDigests 0}}',
    image,
  ])
  return id
}

async function api(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: response.status, body: json }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForEnvironment(requirements, minutes) {
  const started = await api('POST', '/environments', { requirements })
  const id = started.body.id
  const deadline = Date.now() + minutes * 60_000
  while (Date.now() < deadline) {
    const status = await api('GET', `/environments/${id}`)
    if (status.body.state === 'ready' || status.body.state === 'failed')
      return status.body
    await sleep(5_000)
  }
  throw new Error(`Environment ${id} did not finish in ${minutes} minutes.`)
}

const limits = {
  timeoutSeconds: 120,
  memoryMb: 300,
  cpus: 1.5,
  processes: 77,
  scratchMb: 50,
  bytes: 64 * 1024 * 1024,
  rows: 1000,
}

const job = (statement, extra = {}) => ({
  statement,
  inputs: {},
  parameters: {},
  limits,
  ...extra,
})

const probe = `
import os, urllib.request, urllib.error

def read(path):
    try:
        return open(path).read().strip()
    except Exception as error:
        return 'unreadable: %s' % error

def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return 'reached %s' % response.status
    except urllib.error.HTTPError as error:
        return 'reached %s' % error.code
    except Exception as error:
        return 'blocked: %s' % error

def transform(inputs, parameters):
    stat = os.statvfs('/tmp')
    return [{
        'memory_max': read('/sys/fs/cgroup/memory.max'),
        'swap_max': read('/sys/fs/cgroup/memory.swap.max'),
        'pids_max': read('/sys/fs/cgroup/pids.max'),
        'cpu_max': read('/sys/fs/cgroup/cpu.max'),
        'scratch_bytes': stat.f_blocks * stat.f_frsize,
        'declared': fetch('https://pypi.org/simple/'),
        'declared_wildcard': fetch('https://files.pythonhosted.org/'),
        'undeclared': fetch('https://example.com/'),
        'undeclared_plain': fetch('http://example.org/'),
    }]
`

const rdkit = `
from rdkit import Chem
from rdkit.Chem import Descriptors, rdMolDescriptors

def transform(inputs, parameters):
    molecule = Chem.MolFromSmiles('CC(=O)Oc1ccccc1C(=O)O')
    return [{
        'weight': round(Descriptors.MolWt(molecule), 3),
        'formula': rdMolDescriptors.CalcMolFormula(molecule),
    }]
`

async function main() {
  // The base image is pinned by digest, as a real deployment pins it.
  const python = digestOf('python:3.12-slim-bookworm')
  const node = digestOf('node:22-alpine')
  const dockerCli = digestOf('docker:27-cli')

  // The worker image must be digest-pinned too, which a locally built image is
  // not until it has been through a registry.
  run([
    'run',
    '-d',
    '--name',
    names.registry,
    '-p',
    `127.0.0.1:${registryPort}:5000`,
    'registry:2',
  ])
  const worker = `localhost:${registryPort}/sheetbase-python-worker`
  run([
    'build',
    '-f',
    'docker/pipeline-python/Dockerfile',
    '--build-arg',
    `PYTHON_IMAGE=${python}`,
    '-t',
    worker,
    '.',
  ])
  run(['push', '--quiet', worker])
  const workerDigest = out([
    'image',
    'inspect',
    '--format={{index .RepoDigests 0}}',
    worker,
  ])
  check('the worker image builds from the pinned Python image', true)

  run([
    'build',
    '-f',
    'docker/pipeline-python/runner.Dockerfile',
    '--build-arg',
    `DOCKER_CLI_IMAGE=${dockerCli}`,
    '--build-arg',
    `NODE_IMAGE=${node}`,
    '-t',
    'sheetbase-python-runner:ci',
    '.',
  ])
  check('the runner image builds', true)

  // The runner as a deployment runs it: no root, read-only, no capabilities,
  // and the Docker socket as its only way to start sandboxes.
  run(['network', 'create', names.bridge])
  run(['network', 'create', '--internal', names.egress])
  const socketGroup = String(statSync('/var/run/docker.sock').gid)
  run([
    'create',
    '--name',
    names.runner,
    '--network',
    names.bridge,
    '-p',
    `127.0.0.1:${port}:8080`,
    '--user',
    '65532:65532',
    '--group-add',
    socketGroup,
    '-v',
    '/var/run/docker.sock:/var/run/docker.sock',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--pids-limit=64',
    '-e',
    `PIPELINE_PYTHON_RUNNER_TOKEN=${token}`,
    '-e',
    `PIPELINE_PYTHON_IMAGE=${workerDigest}`,
    '-e',
    `PIPELINE_PYTHON_EGRESS_NETWORK=${names.egress}`,
    '-e',
    `PIPELINE_PYTHON_EGRESS_HOST=${names.runner}`,
    'sheetbase-python-runner:ci',
  ])
  run(['network', 'connect', names.egress, names.runner])
  run(['start', names.runner])
  for (let attempt = 0; ; attempt++) {
    const runtime = await api('GET', '/runtime').catch(() => undefined)
    if (runtime?.status === 200) break
    if (attempt > 30)
      throw new Error(
        `The runner did not come up:\n${out(['logs', names.runner], { allowFailure: true })}`,
      )
    await sleep(1_000)
  }
  check('the runner starts and sees the worker image', true)

  // 1. Packages: a failing install says why, a good one is built once.
  const broken = await waitForEnvironment(['no-such-package-sbci==9.9.9'], 5)
  check(
    'an install that fails reports the installer’s own message',
    broken.state === 'failed' &&
      /no-such-package-sbci|No matching/i.test(broken.error ?? ''),
    JSON.stringify(broken),
  )
  const environment = await waitForEnvironment(['rdkit>=2024.3'], 25)
  check(
    'RDKit installs into a plugin environment',
    environment.state === 'ready',
    JSON.stringify(environment),
  )
  const again = await api('POST', '/environments', {
    requirements: ['rdkit>=2024.3'],
  })
  check(
    'the same package list reuses the built image',
    again.status === 200 &&
      again.body.id === environment.id &&
      again.body.state === 'ready',
  )

  // 2. A call that uses the package.
  const chemistry = await api(
    'POST',
    '/execute',
    job(rdkit, { environment: environment.id }),
  )
  check(
    'a sandboxed call that uses RDKit returns its answer',
    chemistry.status === 200 &&
      chemistry.body.rows?.[0]?.formula === 'C9H8O4' &&
      Math.abs(chemistry.body.rows[0].weight - 180.159) < 0.01,
    JSON.stringify(chemistry.body),
  )
  const missing = await api('POST', '/execute', job(rdkit))
  check(
    'the same call without the plugin’s environment cannot import RDKit',
    missing.status === 422,
    JSON.stringify(missing.body),
  )

  // 3. Limits, as the container sees them, and egress, with hosts declared.
  const probed = await api(
    'POST',
    '/execute',
    job(probe, { network: ['pypi.org', '*.pythonhosted.org'] }),
  )
  check(
    'a call with approved hosts runs',
    probed.status === 200,
    JSON.stringify(probed.body),
  )
  const row = probed.body.rows[0]
  check(
    'memory limit is applied',
    row.memory_max === String(300 * 1024 * 1024),
    JSON.stringify(row),
  )
  check('swap is off', row.swap_max === '0', JSON.stringify(row))
  check('process limit is applied', row.pids_max === '77', JSON.stringify(row))
  check(
    'core limit is applied',
    row.cpu_max.startsWith('150000 '),
    JSON.stringify(row),
  )
  check(
    'scratch disk limit is applied',
    row.scratch_bytes === 50 * 1024 * 1024,
    JSON.stringify(row),
  )
  check(
    'the egress proxy lets a declared host through',
    row.declared.startsWith('reached'),
    JSON.stringify(row),
  )
  check(
    'the egress proxy lets a declared wildcard host through',
    row.declared_wildcard.startsWith('reached'),
    JSON.stringify(row),
  )
  check(
    'the egress proxy blocks a host that was not declared (https)',
    row.undeclared.startsWith('blocked'),
    JSON.stringify(row),
  )
  check(
    'the egress proxy blocks a host that was not declared (http)',
    row.undeclared_plain.startsWith('blocked') ||
      row.undeclared_plain === 'reached 403',
    JSON.stringify(row),
  )

  // Without declared hosts there is no network at all.
  const closed = await api('POST', '/execute', job(probe))
  const none = closed.body.rows?.[0]
  check(
    'a call with no approved hosts has no network',
    closed.status === 200 &&
      none.declared.startsWith('blocked') &&
      none.undeclared.startsWith('blocked'),
    JSON.stringify(closed.body),
  )

  // Limits are enforced, not only set.
  const slow = await api(
    'POST',
    '/execute',
    job(
      'import time\ndef transform(i, p):\n    time.sleep(30)\n    return []',
      {
        limits: { ...limits, timeoutSeconds: 3 },
      },
    ),
  )
  check(
    'a call over its time limit is stopped',
    slow.status === 504 && slow.body.code === 'transform_timed_out',
    JSON.stringify(slow.body),
  )
  const hungry = await api(
    'POST',
    '/execute',
    job(
      'def transform(i, p):\n    data = bytearray(900 * 1024 * 1024)\n    for n in range(0, len(data), 4096):\n        data[n] = 1\n    return [{"n": len(data)}]',
    ),
  )
  check(
    'a call over its memory limit is stopped',
    hungry.status !== 200,
    JSON.stringify(hungry.body),
  )

  // A pipeline step, with no limits of its own, keeps the old fixed ones.
  const fixed = await api('POST', '/execute', {
    statement: probe,
    inputs: {},
    parameters: {},
  })
  check(
    'a call with no limits of its own keeps the fixed pipeline limits',
    fixed.status === 200 &&
      fixed.body.rows[0].memory_max === String(512 * 1024 * 1024) &&
      fixed.body.rows[0].pids_max === '64',
    JSON.stringify(fixed.body),
  )
}

async function cleanup() {
  for (const name of [names.runner, names.registry])
    run(['rm', '--force', name], { allowFailure: true })
  for (const name of [names.bridge, names.egress])
    run(['network', 'rm', name], { allowFailure: true })
}

let failed = false
try {
  await main()
} catch (error) {
  failed = true
  console.error(error instanceof Error ? error.message : error)
  const logs = run(['logs', '--tail=80', names.runner], { allowFailure: true })
  console.error(`--- runner log ---\n${logs.stdout}${logs.stderr}`)
} finally {
  await cleanup()
}
console.log(`${passed.length} checks passed`)
process.exit(failed ? 1 : 0)
