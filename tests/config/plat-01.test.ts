import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(
  readFileSync('.github/workflows/deploy.yml', 'utf8'),
) as {
  jobs: Record<string, Record<string, unknown>>
}
const deployCompose = parse(readFileSync('compose.deploy.yaml', 'utf8')) as {
  services: Record<string, { command?: string[] | string }>
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>
}

describe('PLAT-01 deployment gates', () => {
  it('gates the artifact build on a verify job', () => {
    expect(workflow.jobs.verify).toBeDefined()
    expect(workflow.jobs.build.needs).toContain('verify')
  })

  it('verify runs typecheck, lint, unit tests, db tests and a build', () => {
    const names = (workflow.jobs.verify.steps as { name?: string }[])
      .map((s) => s.name ?? '')
      .join('\n')
    for (const expected of [
      'Typecheck',
      'Lint',
      'Unit tests',
      'Database integration tests',
      'Build',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('bootstraps the database role skeleton for db tests', () => {
    const names = (workflow.jobs.verify.steps as { name?: string }[]).map(
      (s) => s.name ?? '',
    )
    expect(names).toContain('Bootstrap database roles')
  })
})

describe('PLAT-01 migration concurrency', () => {
  it('runs migrations through the advisory-lock wrapper', () => {
    const command = deployCompose.services.migrate.command
    const joined = Array.isArray(command) ? command.join(' ') : command
    expect(joined).toContain('scripts/migrate-once.mjs')
  })
})

describe('PLAT-01 backup and restore tooling', () => {
  it('exposes backup:run and backup:restore-drill', () => {
    expect(pkg.scripts['backup:run']).toBeDefined()
    expect(pkg.scripts['backup:restore-drill']).toBeDefined()
  })
})
