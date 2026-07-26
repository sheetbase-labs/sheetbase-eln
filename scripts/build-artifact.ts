import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import {
  assertCleanBuildSource,
  assertImmutableImageReference,
  latestMigrationVersion,
} from '../src/lib/deployment-plan'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${result.status ?? 'unknown'}`,
    )
  }
  return result.stdout.trim()
}

const nodeImage = assertImmutableImageReference(
  required('SHEETBASE_NODE_IMAGE'),
)
const artifactVersion = required('SHEETBASE_ARTIFACT_VERSION')
const imageTag = required('SHEETBASE_ARTIFACT_TAG')
if (imageTag.endsWith(':latest'))
  throw new Error('SHEETBASE_ARTIFACT_TAG must not use latest')

const journal = JSON.parse(
  readFileSync('drizzle/meta/_journal.json', 'utf8'),
) as Parameters<typeof latestMigrationVersion>[0]
const migration = latestMigrationVersion(journal)
const sourceRevision = run('git', ['rev-parse', 'HEAD'])
const sourceStatus = run('git', [
  'status',
  '--porcelain',
  '--untracked-files=all',
])
assertCleanBuildSource(sourceStatus)

run('docker', [
  'build',
  '--build-arg',
  `NODE_IMAGE=${nodeImage}`,
  '--build-arg',
  `ARTIFACT_VERSION=${artifactVersion}`,
  '--build-arg',
  `SOURCE_REVISION=${sourceRevision}`,
  '--build-arg',
  `EXPECTED_MIGRATION=${migration.version}`,
  '--tag',
  imageTag,
  '.',
])

const imageId = run('docker', [
  'image',
  'inspect',
  '--format',
  '{{.Id}}',
  imageTag,
])
if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) {
  throw new Error(`Docker returned an invalid immutable image id: ${imageId}`)
}

process.stdout.write(
  `${JSON.stringify(
    {
      imageTag,
      imageId,
      artifactVersion,
      sourceRevision,
      expectedMigration: migration,
    },
    null,
    2,
  )}\n`,
)
