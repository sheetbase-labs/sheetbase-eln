import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const deployCompose = parse(readFileSync('compose.deploy.yaml', 'utf8')) as {
  services: Record<string, { environment: Record<string, string> }>
}

const alerts = parse(readFileSync('deploy/alerts.yml', 'utf8')) as {
  groups: { rules: { alert: string }[] }[]
}

const routeTree = readFileSync('src/routeTree.gen.ts', 'utf8')

describe('PLAT-02 metrics deployment wiring', () => {
  it('injects the metrics token and stale threshold into the app container', () => {
    const env = deployCompose.services.app.environment
    expect(env.SHEETBASE_METRICS_TOKEN).toContain(
      '${SHEETBASE_METRICS_TOKEN:-}',
    )
    expect(env.SHEETBASE_CONNECTOR_RUN_STALE_SECONDS).toContain(
      '${SHEETBASE_CONNECTOR_RUN_STALE_SECONDS:-900}',
    )
  })

  it('registers the /api/metrics route in the committed route tree', () => {
    expect(routeTree).toContain('api/metrics')
  })
})

describe('PLAT-02 alert contract', () => {
  it('defines the initial alert set', () => {
    const names = alerts.groups.flatMap((g) => g.rules.map((r) => r.alert))
    for (const expected of [
      'SheetbaseReadinessFailing',
      'SheetbaseServerErrorRateHigh',
      'SheetbaseDatabaseUnavailable',
      'SheetbaseConnectorFailureRateHigh',
      'SheetbaseConnectorStaleRuns',
      'SheetbaseBackupMissing',
      'SheetbaseRestoreDrillFailing',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('only references metrics the application actually renders', () => {
    const rendered = readFileSync('src/lib/metrics.ts', 'utf8')
    const alertsRaw = readFileSync('deploy/alerts.yml', 'utf8')
    const metricNames = [...alertsRaw.matchAll(/sheetbase_[a-z_]+/g)].map(
      (m) => m[0],
    )
    for (const name of new Set(metricNames)) {
      // Backup/restore textfile signals are emitted by the ops scripts, not
      // the app registry; everything else must exist in the registry.
      if (
        name === 'sheetbase_backup_success_time_seconds' ||
        name === 'sheetbase_restore_drill_success'
      ) {
        continue
      }
      expect(rendered).toContain(name.replace(/^sheetbase_/, 'sheetbase_'))
    }
  })
})
