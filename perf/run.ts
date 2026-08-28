/**
 * PLAT-05 — benchmark orchestrator.
 *
 *   pnpm perf:seed        → deterministic fixtures (all sizes)
 *   pnpm perf:db          → dataset/version/write/snapshot benchmarks
 *   pnpm perf:pipelines   → pipeline stage/concurrency + scheduler/event
 *   pnpm perf:http        → API-layer concurrency vs PostgREST
 *   pnpm perf:all         → seed + db + pipelines + http
 *
 * Every script requires SHEETBASE_ENV=development and
 * PERF_CONFIRM=local-destructive, with loopback DATABASE_URL / PGRST_DB_URI.
 * Results are written to perf/results/<timestamp>-<section>.json.
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

function section(
  name: string,
  args: string[],
): { status: number; stdout: string } {
  const result = spawnSync(
    'node',
    ['--import', 'tsx', join('perf', `${name}.ts`), ...args],
    {
      stdio: 'pipe',
      encoding: 'utf8',
    },
  )
  process.stdout.write(result.stdout)
  process.stderr.write(result.stderr)
  return { status: result.status ?? 1, stdout: result.stdout }
}

async function main(): Promise<void> {
  const arg = process.argv[2] ?? 'all'
  const large = process.argv.includes('--large')
  let exit = 0
  if (arg === 'seed' || arg === 'all') {
    exit = Math.max(exit, section('fixtures', []).status)
  }
  if (arg === 'db' || arg === 'all') {
    exit = Math.max(exit, section('dataset', large ? ['--large'] : []).status)
  }
  if (arg === 'pipelines' || arg === 'all') {
    exit = Math.max(exit, section('pipelines', large ? ['--large'] : []).status)
  }
  if (arg === 'http' || arg === 'all') {
    exit = Math.max(exit, section('http', []).status)
  }
  if (arg === 'files' || arg === 'all') {
    exit = Math.max(exit, section('files', []).status)
  }
  if (exit !== 0) {
    console.error(`perf run failed with status ${exit}`)
    process.exitCode = exit
  } else {
    console.log('perf_all_status=PASS')
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
