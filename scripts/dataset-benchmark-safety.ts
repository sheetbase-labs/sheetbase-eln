const CONFIRMATION = 'local-destructive'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface DatasetBenchmarkEnvironment {
  SHEETBASE_ENV?: string
  DATABASE_URL?: string
  PGRST_DB_URI?: string
  CORE_DATASET_BENCHMARK_CONFIRM?: string
}

export interface SafeDatasetBenchmarkEnvironment {
  databaseUrl: string
  pgrstDatabaseUrl: string
}

function assertLoopbackUrl(name: string, value: string | undefined): string {
  if (!value)
    throw new Error(`${name} is required for the local Dataset benchmark`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid loopback PostgreSQL URL`)
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${name} must be a valid loopback PostgreSQL URL`)
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `${name} must use a loopback host for the local Dataset benchmark`,
    )
  }
  return value
}

/** Refuse destructive fixture work unless the complete local opt-in is present. */
export function assertSafeDatasetBenchmarkEnvironment(
  environment: DatasetBenchmarkEnvironment,
): SafeDatasetBenchmarkEnvironment {
  if (environment.SHEETBASE_ENV !== 'development') {
    throw new Error(
      'SHEETBASE_ENV must be development for the local Dataset benchmark',
    )
  }
  if (environment.CORE_DATASET_BENCHMARK_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set CORE_DATASET_BENCHMARK_CONFIRM=${CONFIRMATION} to confirm the destructive local Dataset benchmark`,
    )
  }
  return {
    databaseUrl: assertLoopbackUrl('DATABASE_URL', environment.DATABASE_URL),
    pgrstDatabaseUrl: assertLoopbackUrl(
      'PGRST_DB_URI',
      environment.PGRST_DB_URI,
    ),
  }
}
