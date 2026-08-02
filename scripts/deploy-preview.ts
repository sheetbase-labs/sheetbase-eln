import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'

import { validateDeploymentConfig } from '../src/lib/deployment-config'
import {
  assertImmutableImageReference,
  validateArtifactImageMetadata,
} from '../src/lib/deployment-plan'
import {
  normalizePreviewRoutes,
  parsePullRequestNumber,
  previewAppPort,
  previewHostname,
  previewProjectName,
  previewRoute,
  removePreviewRoute,
  upsertPreviewRoute,
} from '../src/lib/preview-deployment'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function compose(args: string[]) {
  const project = required('SHEETBASE_PREVIEW_PROJECT')
  const env = { ...process.env }
  // Compose interpolates the full file even for `down`; these values are never
  // passed to a container during cleanup and avoid requiring preview secrets
  // for the merge/close event.
  for (const name of [
    'POSTGRES_DB',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGREST_AUTHENTICATOR_PASSWORD',
    'MIGRATOR_PASSWORD',
    'FORMULA_WRITER_PASSWORD',
    'PGRST_JWT_SECRET',
    'BETTER_AUTH_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'SHEETBASE_PREVIEW_PUBLIC_ORIGIN',
    'SHEETBASE_ARTIFACT_DIGEST',
    'SHEETBASE_APP_IMAGE',
    'SHEETBASE_POSTGREST_IMAGE',
    'SHEETBASE_PREVIEW_APP_PORT',
  ]) {
    env[name] ??= 'cleanup-not-used'
  }
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      '-f',
      'compose.preview.yaml',
      ...args,
    ],
    { stdio: 'inherit', env },
  )
  if (result.status !== 0)
    throw new Error(`docker compose ${args.join(' ')} failed`)
}

function dockerIds(args: string[]): string[] {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  })
  if (result.status !== 0) throw new Error(`docker ${args.join(' ')} failed`)
  return result.stdout.trim().split(/\s+/).filter(Boolean)
}

function forceRemoveProjectResources() {
  const label = `com.docker.compose.project=${required('SHEETBASE_PREVIEW_PROJECT')}`
  const containers = dockerIds(['ps', '-aq', '--filter', `label=${label}`])
  if (containers.length) capture('docker', ['rm', '-f', ...containers])
  const volumes = dockerIds([
    'volume',
    'ls',
    '-q',
    '--filter',
    `label=${label}`,
  ])
  if (volumes.length) capture('docker', ['volume', 'rm', ...volumes])
  const networks = dockerIds([
    'network',
    'ls',
    '-q',
    '--filter',
    `label=${label}`,
  ])
  if (networks.length) capture('docker', ['network', 'rm', ...networks])
}

async function sleep(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function cleanupProject() {
  let cleanupError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      compose(['down', '--volumes', '--remove-orphans'])
      return
    } catch (error) {
      cleanupError = error
      await sleep(attempt * 1000)
    }
  }
  try {
    // Compose labels are scoped to the validated sheetbase-pr-N project.
    forceRemoveProjectResources()
  } catch {
    throw cleanupError
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  const code = error.code
  return typeof code === 'string' ? code : undefined
}

async function withRegistryLock<T>(
  registryPath: string,
  operation: () => Promise<T>,
) {
  const lockPath = `${registryPath}.lock`
  await mkdir(dirname(registryPath), { recursive: true })
  let handle
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx')
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      await sleep(250)
    }
  }
  if (!handle)
    throw new Error(`timed out waiting for preview registry lock: ${lockPath}`)
  try {
    return await operation()
  } finally {
    await handle.close()
    await rm(lockPath, { force: true })
  }
}

async function readRoutes(registryPath: string) {
  try {
    return normalizePreviewRoutes(
      JSON.parse(await readFile(registryPath, 'utf8')),
    )
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
}

async function writeRoutes(registryPath: string, routes: unknown[]) {
  await mkdir(dirname(registryPath), { recursive: true })
  const temporaryPath = `${registryPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(routes, null, 2)}\n`, {
    mode: 0o640,
  })
  await rename(temporaryPath, registryPath)
}

async function waitForLocalReadiness(
  port: number,
  expected: { version: string; digest: string; migration: string },
) {
  const url = `http://127.0.0.1:${port}/api/health/ready`
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(url)
      const body = await response.json()
      if (
        response.ok &&
        body.status === 'ready' &&
        body.artifact?.version === expected.version &&
        body.artifact?.digest === expected.digest &&
        body.database?.migration?.status === 'compatible' &&
        body.database?.migration?.expected === expected.migration
      ) {
        return body
      }
    } catch {
      // Bounded retry while Compose and the app finish starting.
    }
    await sleep(5000)
  }
  throw new Error(
    `preview readiness did not prove the selected artifact on ${url}`,
  )
}

const mode = process.argv[2] ?? '--deploy'
if (!['--deploy', '--cleanup'].includes(mode)) {
  throw new Error('usage: deploy-preview.ts [--deploy|--cleanup]')
}

const pullRequestNumber = parsePullRequestNumber(
  required('SHEETBASE_PREVIEW_NUMBER'),
)
const baseDomain = required('SHEETBASE_PREVIEW_BASE_DOMAIN')
const hostname = previewHostname(pullRequestNumber, baseDomain)
const registryPath =
  process.env.SHEETBASE_PREVIEW_ROUTES_FILE ??
  '/opt/sheetbase-preview/routes.json'
process.env.SHEETBASE_PREVIEW_PROJECT = previewProjectName(pullRequestNumber)
process.env.SHEETBASE_PREVIEW_APP_PORT = String(
  previewAppPort(pullRequestNumber),
)
process.env.SHEETBASE_PREVIEW_PUBLIC_ORIGIN = `https://${hostname}`

if (mode === '--cleanup') {
  const routes = await withRegistryLock(registryPath, async () => {
    const updated = removePreviewRoute(
      await readRoutes(registryPath),
      pullRequestNumber,
    )
    await writeRoutes(registryPath, updated)
    return updated
  })
  await cleanupProject()
  process.stdout.write(
    `${JSON.stringify({ action: 'cleanup', pullRequestNumber, hostname, remainingRoutes: routes.length })}\n`,
  )
  process.exit(0)
}

const applicationImage = assertImmutableImageReference(
  required('SHEETBASE_APP_IMAGE'),
)
const postgrestImage = assertImmutableImageReference(
  required('SHEETBASE_POSTGREST_IMAGE'),
)
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

validateDeploymentConfig({
  SHEETBASE_ENV: 'preview',
  SHEETBASE_SECRET_SOURCE: 'vps-local',
  SHEETBASE_ARTIFACT_VERSION: imageMetadata.version,
  SHEETBASE_ARTIFACT_DIGEST: imageDigest,
  SHEETBASE_EXPECTED_MIGRATION: imageMetadata.expectedMigration,
  BETTER_AUTH_URL: process.env.SHEETBASE_PREVIEW_PUBLIC_ORIGIN,
  DATABASE_URL: 'postgresql://sheetbase:preview@postgres:5432/sheetbase',
  POSTGREST_URL: 'http://postgrest:3000',
  POSTGREST_ADMIN_URL: 'http://postgrest:3001',
  GITHUB_CLIENT_ID: required('GITHUB_CLIENT_ID'),
  GITHUB_CLIENT_SECRET: required('GITHUB_CLIENT_SECRET'),
})

process.env.SHEETBASE_APP_IMAGE = applicationImage
process.env.SHEETBASE_POSTGREST_IMAGE = postgrestImage
process.env.SHEETBASE_ARTIFACT_DIGEST = imageDigest

const route = previewRoute(pullRequestNumber, baseDomain)
await withRegistryLock(registryPath, async () => {
  await writeRoutes(
    registryPath,
    upsertPreviewRoute(await readRoutes(registryPath), route),
  )
})

try {
  compose(['run', '--rm', 'migrate'])
  compose(['up', '-d', '--wait', 'app'])
  const readiness = await waitForLocalReadiness(
    Number(process.env.SHEETBASE_PREVIEW_APP_PORT),
    {
      version: imageMetadata.version,
      digest: imageDigest,
      migration: imageMetadata.expectedMigration,
    },
  )
  process.stdout.write(
    `${JSON.stringify(
      {
        action: 'deploy',
        pullRequestNumber,
        hostname,
        url: process.env.SHEETBASE_PREVIEW_PUBLIC_ORIGIN,
        project: process.env.SHEETBASE_PREVIEW_PROJECT,
        appPort: process.env.SHEETBASE_PREVIEW_APP_PORT,
        artifact: imageMetadata,
        digest: imageDigest,
        readiness,
      },
      null,
      2,
    )}\n`,
  )
} catch (error) {
  try {
    await cleanupProject()
  } catch {
    // Preserve the original deployment error; cleanup is best effort.
  }
  try {
    await withRegistryLock(registryPath, async () => {
      await writeRoutes(
        registryPath,
        removePreviewRoute(await readRoutes(registryPath), pullRequestNumber),
      )
    })
  } catch {
    // The original rollout failure remains the actionable error.
  }
  throw error
}
