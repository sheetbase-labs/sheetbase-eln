import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe('PLAT-03 security pipeline', () => {
  const workflow = parse(
    readFileSync('.github/workflows/security.yml', 'utf8'),
  ) as {
    on: Record<string, unknown>
    jobs: Record<string, Record<string, unknown>>
  }

  it('runs CodeQL SAST on main pushes and a weekly schedule', () => {
    // CodeQL deliberately does not run per-PR (the pre-merge dependency audit
    // covers the gate at a fraction of the cost); the full toolchain runs
    // once per merge on main.
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining(['push', 'schedule']),
    )
    expect(workflow.on.pull_request).toBeUndefined()
    expect(workflow.jobs.codeql).toBeDefined()
  })

  it('runs a lightweight dependency audit on every pull request (pre-merge)', () => {
    const prAudit = parse(
      readFileSync('.github/workflows/pr-dependency-audit.yml', 'utf8'),
    ) as { on: Record<string, unknown>; jobs: Record<string, unknown> }
    expect(prAudit.on.pull_request).toBeTruthy()
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8')
    expect(prAudit.jobs).toBeDefined()
    expect(deploy).toContain('pnpm audit --prod --audit-level=high')
  })

  it('runs the dependency audit for visibility outside the gate', () => {
    const names = (
      workflow.jobs['dependency-audit'].steps as { name?: string }[]
    )
      .map((s) => s.name ?? '')
      .join('\n')
    expect(names).toContain('Audit production dependencies')
  })

  it('enforces the dependency audit in the release gate', () => {
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8')
    expect(deploy).toContain('pnpm audit --prod --audit-level=high')
  })

  it('runs the full database suite in the gate (no baseline exclusions)', () => {
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8')
    expect(deploy).toContain('run: pnpm test:db')
    expect(deploy).not.toContain('--exclude')
  })
})

describe('PLAT-03 dependency policy', () => {
  it('keeps the patched-advisory overrides in pnpm-workspace.yaml', () => {
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8')
    expect(workspace).toContain("'js-yaml@>=4.0.0 <4.3.1': '>=4.3.1'")
    expect(workspace).toContain("'nanoid@>=3.0.0 <3.3.18': '>=3.3.18'")
  })
})

describe('PLAT-03 security documentation', () => {
  it('documents the audited surfaces', () => {
    const security = readFileSync('docs/security.md', 'utf8')
    for (const surface of [
      'Authentication',
      'Sessions',
      'PostgREST proxy',
      'File uploads/downloads',
      'Connectors',
      'SECURITY DEFINER RPCs',
      'RLS',
      'Backups',
      'Metrics endpoint (`/api/metrics`)',
    ]) {
      expect(security).toContain(surface)
    }
  })

  it('links the security doc from the observability and recovery docs', () => {
    expect(readFileSync('docs/observability.md', 'utf8')).not.toBeNull()
  })
})
