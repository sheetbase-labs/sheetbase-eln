import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { validateDeploymentConfig } from '../src/lib/deployment-config'
import {
  assertImmutableImageReference,
  buildDeploymentPlan,
  latestMigrationVersion,
  validateArtifactImageMetadata,
} from '../src/lib/deployment-plan'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

const applicationImage = assertImmutableImageReference(
  required('SHEETBASE_APP_IMAGE'),
)
const postgrestImage = assertImmutableImageReference(
  required('SHEETBASE_POSTGREST_IMAGE'),
)
const pythonEnabled = Boolean(
  process.env.SHEETBASE_PYTHON_RUNNER_IMAGE ||
  process.env.SHEETBASE_PYTHON_IMAGE,
)
const pythonImages = pythonEnabled
  ? {
      runner: assertImmutableImageReference(
        required('SHEETBASE_PYTHON_RUNNER_IMAGE'),
      ),
      runtime: assertImmutableImageReference(
        required('SHEETBASE_PYTHON_IMAGE'),
      ),
    }
  : undefined
if (pythonImages) {
  if (required('PIPELINE_PYTHON_RUNNER_TOKEN').length < 32)
    throw new Error('Python runner token must contain at least 32 characters')
  if (!/^\d+$/.test(required('PIPELINE_DOCKER_SOCKET_GID')))
    throw new Error('Python Docker socket group must be numeric')
  // Plan mode remains read-only. Images must be installed through the reviewed delivery flow.
  capture('docker', [
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    pythonImages.runner,
    pythonImages.runtime,
  ])
}
const composeFiles = [
  '-f',
  'compose.deploy.yaml',
  ...(pythonImages ? ['-f', 'compose.pipeline-python.yaml'] : []),
]
const imageDigest = applicationImage.split('@').at(-1)
if (!imageDigest) throw new Error('application image has no digest')

const imageLabels = JSON.parse(
  capture('docker', [
    'image',
    'inspect',
    '--format',
    '{{json .Config.Labels}}',
    applicationImage,
  ]),
) as Record<string, unknown>
const imageMetadata = validateArtifactImageMetadata(imageLabels)
// These names resolve on the private Compose network. They are deployment
// topology, not host-level secrets, so keep the controller aligned with
// compose.deploy.yaml when they are not present in .env.production.
const postgrestUrl = process.env.POSTGREST_URL ?? 'http://postgrest:3000'
const postgrestAdminUrl =
  process.env.POSTGREST_ADMIN_URL ?? 'http://postgrest:3001'

const deployment = validateDeploymentConfig({
  SHEETBASE_ENV: required('SHEETBASE_ENV') as 'staging' | 'production',
  SHEETBASE_SECRET_SOURCE: required(
    'SHEETBASE_SECRET_SOURCE',
  ) as 'secret-manager',
  SHEETBASE_ARTIFACT_VERSION: imageMetadata.version,
  SHEETBASE_ARTIFACT_DIGEST: imageDigest,
  SHEETBASE_EXPECTED_MIGRATION: imageMetadata.expectedMigration,
  BETTER_AUTH_URL: required('BETTER_AUTH_URL'),
  DATABASE_URL: required('DATABASE_URL'),
  POSTGREST_URL: postgrestUrl,
  POSTGREST_ADMIN_URL: postgrestAdminUrl,
  GITHUB_CLIENT_ID: required('GITHUB_CLIENT_ID'),
  GITHUB_CLIENT_SECRET: required('GITHUB_CLIENT_SECRET'),
})
if (
  deployment.environment !== 'staging' &&
  deployment.environment !== 'production'
) {
  throw new Error('deployment flow is restricted to staging or production')
}

const journal = JSON.parse(
  readFileSync('drizzle/meta/_journal.json', 'utf8'),
) as Parameters<typeof latestMigrationVersion>[0]
const repositoryMigration = latestMigrationVersion(journal)
if (repositoryMigration.version !== deployment.expectedMigration) {
  throw new Error(
    `artifact expects migration ${deployment.expectedMigration}, but this checkout ends at ${repositoryMigration.version} (${repositoryMigration.tag})`,
  )
}

process.env.SHEETBASE_ARTIFACT_DIGEST = imageDigest

const plan = buildDeploymentPlan({
  environment: deployment.environment,
  applicationImage,
  postgrestImage,
  pythonImages,
  expectedMigration: deployment.expectedMigration,
  // The documented public HTTPS endpoint remains part of the deployment
  // contract. The controller can optionally prove readiness through the
  // VPS-local listener after Compose starts.
  readinessUrl: required('SHEETBASE_READINESS_URL'),
  publicOrigin: required('BETTER_AUTH_URL'),
})

const mode = process.argv[2] ?? '--plan'
if (mode !== '--plan' && mode !== '--apply') {
  throw new Error('usage: deploy.ts [--plan|--apply]')
}

process.stdout.write(`${JSON.stringify({ mode, plan }, null, 2)}\n`)
if (mode === '--plan') process.exit(0)

function compose(args: string[]) {
  const result = spawnSync('docker', ['compose', ...composeFiles, ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed`)
  }
}

function isolateFailedRollout() {
  const result = spawnSync(
    'docker',
    ['compose', ...composeFiles, 'rm', '-sf', 'app'],
    { stdio: 'inherit', env: process.env },
  )
  if (result.status !== 0) {
    process.stderr.write(
      `${JSON.stringify({ level: 'error', message: 'failed to isolate rejected application rollout' })}\n`,
    )
  }
}

compose(['run', '--rm', 'migrate'])
try {
  compose([
    'up',
    '-d',
    '--wait',
    ...(pythonImages ? ['pipeline-python-runner'] : []),
    'app',
  ])
  if (pythonImages) {
    const runtime = capture('docker', [
      'compose',
      ...composeFiles,
      'exec',
      '-T',
      'app',
      'node',
      '-e',
      "fetch(process.env.PIPELINE_PYTHON_RUNNER_URL + '/runtime', {headers: {authorization: 'Bearer ' + process.env.PIPELINE_PYTHON_RUNNER_TOKEN}, signal: AbortSignal.timeout(10000)}).then(async r => {if (!r.ok) process.exit(1); process.stdout.write((await r.json()).runtime)}).catch(() => process.exit(1))",
    ])
    if (runtime !== pythonImages.runtime)
      throw new Error(
        'Python runtime identity did not match the deployment plan',
      )
  }
} catch (error) {
  isolateFailedRollout()
  throw error
}

const readinessUrl =
  process.env.SHEETBASE_LOCAL_READINESS_URL ??
  required('SHEETBASE_READINESS_URL')
let evidence: unknown
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const response = await fetch(readinessUrl)
    const body = await response.json()
    if (
      response.ok &&
      body.status === 'ready' &&
      body.artifact?.version === deployment.artifact.version &&
      body.artifact?.digest === deployment.artifact.digest &&
      body.database?.migration?.status === 'compatible' &&
      body.database?.migration?.expected === deployment.expectedMigration
    ) {
      evidence = body
      break
    }
  } catch {
    // Retry during the bounded rollout window; final failure is explicit.
  }
  await new Promise((resolve) => setTimeout(resolve, 5000))
}
if (!evidence) {
  isolateFailedRollout()
  throw new Error(
    'readiness did not prove artifact and migration compatibility within 60 seconds',
  )
}

process.stdout.write(
  `${JSON.stringify(
    {
      deployedAt: new Date().toISOString(),
      environment: deployment.environment,
      artifact: deployment.artifact,
      expectedMigration: deployment.expectedMigration,
      readiness: evidence,
    },
    null,
    2,
  )}\n`,
)
