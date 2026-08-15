import { describe, expect, it } from 'vitest'

import {
  assertCleanBuildSource,
  assertImmutableImageReference,
  buildDeploymentPlan,
  latestMigrationVersion,
  validateArtifactImageMetadata,
} from './deployment-plan'

const digest = `sha256:${'b'.repeat(64)}`

describe('deployment contract', () => {
  it('rejects mutable image references', () => {
    expect(() => assertImmutableImageReference('sheetbase/app:latest')).toThrow(
      /digest/,
    )
    expect(
      assertImmutableImageReference(`registry.example/sheetbase/app@${digest}`),
    ).toBe(`registry.example/sheetbase/app@${digest}`)
  })

  it('reads the exact expected database version from the migration journal', () => {
    expect(
      latestMigrationVersion({
        entries: [
          { when: 1784910000000, tag: '0035_previous' },
          { when: 1784920000000, tag: '0036_current' },
        ],
      }),
    ).toEqual({ version: '1784920000000', tag: '0036_current' })
  })

  it('orders migration, rollout and compatibility readiness without leaking secrets into commands', () => {
    const plan = buildDeploymentPlan({
      environment: 'staging',
      applicationImage: `registry.example/sheetbase/app@${digest}`,
      postgrestImage: `postgrest/postgrest@sha256:${'c'.repeat(64)}`,
      expectedMigration: '1784920000000',
      readinessUrl: 'https://staging.sheetbase.example/api/health/ready',
      publicOrigin: 'https://staging.sheetbase.example',
    })

    expect(plan.map((step) => step.name)).toEqual([
      'migrate',
      'rollout',
      'readiness',
    ])
    expect(plan[0]?.command).toContain('run --rm migrate')
    expect(plan[1]?.command).toContain('up -d --wait app')
    expect(plan[2]).toEqual(
      expect.objectContaining({
        expectedMigration: '1784920000000',
        readinessUrl: 'https://staging.sheetbase.example/api/health/ready',
      }),
    )
    expect(JSON.stringify(plan)).not.toMatch(/password|secret/i)
  })

  it('binds readiness evidence to the target public origin', () => {
    expect(() =>
      buildDeploymentPlan({
        environment: 'production',
        applicationImage: `registry.example/sheetbase/app@${digest}`,
        postgrestImage: `postgrest/postgrest@sha256:${'c'.repeat(64)}`,
        expectedMigration: '1784920000000',
        readinessUrl: 'https://staging.sheetbase.example/api/health/ready',
        publicOrigin: 'https://sheetbase.example',
      }),
    ).toThrow(/target public origin/)
  })

  it('requires complete immutable application image metadata', () => {
    expect(
      validateArtifactImageMetadata({
        'org.opencontainers.image.version': '2026.07.26',
        'org.opencontainers.image.revision': '4f9c3c1',
        'uk.co.sheetbase.expected-migration': '1784920000000',
      }),
    ).toEqual({
      version: '2026.07.26',
      sourceRevision: '4f9c3c1',
      expectedMigration: '1784920000000',
    })

    expect(() =>
      validateArtifactImageMetadata({
        'org.opencontainers.image.version': '2026.07.26',
      }),
    ).toThrow(/image metadata/)
  })

  it('rejects a build whose Git revision does not describe the copied files', () => {
    expect(() => assertCleanBuildSource(' M src/example.ts')).toThrow(
      /clean Git worktree/,
    )
    expect(() => assertCleanBuildSource('?? untracked.txt')).toThrow(
      /clean Git worktree/,
    )
    expect(() => assertCleanBuildSource('')).not.toThrow()
  })
})
