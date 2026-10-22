import type { DeploymentEnvironment } from './deployment-config'

const immutableImagePattern = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/

export function assertCleanBuildSource(status: string): void {
  if (status.trim().length > 0) {
    throw new Error(
      'artifact builds require a clean Git worktree so the source revision identifies the built bytes',
    )
  }
}

export function assertImmutableImageReference(reference: string): string {
  if (!immutableImagePattern.test(reference)) {
    throw new Error(
      `image reference must include an immutable sha256 digest: ${reference}`,
    )
  }
  return reference
}

interface MigrationJournal {
  entries: Array<{ when: number; tag: string }>
}

export function latestMigrationVersion(journal: MigrationJournal): {
  version: string
  tag: string
} {
  const latest = journal.entries.at(-1)
  if (!latest || !Number.isSafeInteger(latest.when) || !latest.tag) {
    throw new Error('migration journal has no valid latest entry')
  }
  return { version: String(latest.when), tag: latest.tag }
}

export interface DeploymentPlanInput {
  environment: Extract<DeploymentEnvironment, 'staging' | 'production'>
  applicationImage: string
  postgrestImage: string
  pythonImages?: { runner: string; runtime: string }
  expectedMigration: string
  readinessUrl: string
  publicOrigin: string
}

export interface ArtifactImageMetadata {
  version: string
  sourceRevision: string
  expectedMigration: string
}

export function validateArtifactImageMetadata(
  labels: Record<string, unknown>,
): ArtifactImageMetadata {
  const version = labels['org.opencontainers.image.version']
  const sourceRevision = labels['org.opencontainers.image.revision']
  const expectedMigration = labels['uk.co.sheetbase.expected-migration']
  if (
    typeof version !== 'string' ||
    version.length === 0 ||
    typeof sourceRevision !== 'string' ||
    sourceRevision.length === 0 ||
    typeof expectedMigration !== 'string' ||
    !/^\d{13}$/.test(expectedMigration)
  ) {
    throw new Error(
      'application image metadata must include version, source revision, and a 13-digit expected migration',
    )
  }
  return { version, sourceRevision, expectedMigration }
}

export type DeploymentStep =
  | { name: 'backup' | 'migrate' | 'rollout'; command: string }
  | {
      name: 'readiness'
      command: string
      readinessUrl: string
      expectedMigration: string
    }

export function buildDeploymentPlan(
  input: DeploymentPlanInput,
): DeploymentStep[] {
  assertImmutableImageReference(input.applicationImage)
  assertImmutableImageReference(input.postgrestImage)
  if (!/^\d{13}$/.test(input.expectedMigration)) {
    throw new Error(
      'expected migration must be the 13-digit Drizzle journal version',
    )
  }
  const readinessUrl = new URL(input.readinessUrl)
  if (readinessUrl.protocol !== 'https:') {
    throw new Error('deployed readiness URL must use HTTPS')
  }
  const publicOrigin = new URL(input.publicOrigin)
  if (readinessUrl.origin !== publicOrigin.origin) {
    throw new Error('readiness URL must use the target public origin')
  }
  if (readinessUrl.pathname !== '/api/health/ready') {
    throw new Error('readiness URL must target /api/health/ready')
  }

  if (input.pythonImages) {
    assertImmutableImageReference(input.pythonImages.runner)
    assertImmutableImageReference(input.pythonImages.runtime)
  }
  const compose =
    'docker compose -f compose.deploy.yaml' +
    (input.pythonImages ? ' -f compose.pipeline-python.yaml' : '')
  return [
    {
      name: 'backup',
      command:
        'node --import tsx scripts/backup.ts (complete database + objects required)',
    },
    { name: 'migrate', command: `${compose} run --rm migrate` },
    {
      name: 'rollout',
      command: `${compose} up -d --wait ${input.pythonImages ? 'pipeline-python-runner ' : ''}app`,
    },
    {
      name: 'readiness',
      command: `GET ${readinessUrl.toString()}`,
      readinessUrl: readinessUrl.toString(),
      expectedMigration: input.expectedMigration,
    },
  ]
}
