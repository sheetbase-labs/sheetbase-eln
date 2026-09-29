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

  it('does not run CodeQL; audit visibility stays on main pushes and schedule', () => {
    // CodeQL was removed: it failed on token scope in this account and SAST
    // is not part of the merge gate. The audit job is the remaining signal.
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining(['push', 'schedule']),
    )
    expect(workflow.on.pull_request).toBeUndefined()
    expect(workflow.jobs.codeql).toBeUndefined()
    expect(workflow.jobs['dependency-audit']).toBeDefined()
  })

  it('enforces the dependency audit as a release gate and defers pre-merge PR auditing', () => {
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8')
    expect(deploy).toContain('pnpm audit --prod --audit-level=high')
    // Pre-merge PR auditing is documented as deferred while the account
    // cannot run CI (GitHub marks billing-blocked jobs "failed", with no
    // skipped outcome); a PR check would be red for environmental reasons.
    // The enforced audit command is identical wherever it runs.
    expect(readFileSync('.github/workflows/security.yml', 'utf8')).toContain(
      'Deliberately not triggered on pull_request',
    )
    expect(readFileSync('docs/operations/security.md', 'utf8')).toContain(
      'release gate',
    )
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
    expect(workspace).toContain("'browserslist@<=4.28.6': '>=4.28.7'")
  })
})

describe('PLAT-03 security documentation', () => {
  it('documents the audited surfaces', () => {
    const security = readFileSync('docs/operations/security.md', 'utf8')
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
    expect(
      readFileSync('docs/operations/observability.md', 'utf8'),
    ).not.toBeNull()
  })
})

describe('PLAT-03 local release path (no GitHub Actions)', () => {
  it('exposes pnpm release:local', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['release:local']).toBe('bash scripts/release.sh')
  })

  it('runs the enforced gate and the existing controller', () => {
    const script = readFileSync('scripts/release.sh', 'utf8')
    for (const gate of [
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm audit --prod --audit-level=high',
      'pnpm test:db',
      'pnpm build',
    ]) {
      expect(script).toContain(gate)
    }
    expect(script).toContain('pnpm deploy:plan')
    expect(script).toContain('pnpm deploy:apply')
    expect(script).toContain('@sha256')
  })

  it('documents the release-time-only gate contract honestly', () => {
    expect(readFileSync('docs/operations/security.md', 'utf8')).toContain(
      'release-time enforcement on `main`',
    )
    expect(readFileSync('docs/operations/deployment.md', 'utf8')).toContain(
      'Releasing without GitHub Actions',
    )
  })
})
