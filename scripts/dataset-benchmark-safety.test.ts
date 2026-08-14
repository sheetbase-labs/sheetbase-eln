import { describe, expect, it } from 'vitest'

import { assertSafeDatasetBenchmarkEnvironment } from './dataset-benchmark-safety'

const safe = {
  SHEETBASE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:secret@localhost:5432/sheetbase',
  PGRST_DB_URI: 'postgresql://user:secret@127.0.0.1:5432/sheetbase',
  CORE_DATASET_BENCHMARK_CONFIRM: 'local-destructive',
}

describe('Dataset benchmark environment safety', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts an explicit development opt-in with loopback host %s',
    (host) => {
      const databaseUrl = `postgresql://user:secret@${host}:5432/sheetbase`
      const pgrstDatabaseUrl = `postgres://user:secret@${host}:5432/sheetbase`
      expect(
        assertSafeDatasetBenchmarkEnvironment({
          ...safe,
          DATABASE_URL: databaseUrl,
          PGRST_DB_URI: pgrstDatabaseUrl,
        }),
      ).toEqual({ databaseUrl, pgrstDatabaseUrl })
    },
  )

  it('returns the guarded connection URLs unchanged', () => {
    expect(assertSafeDatasetBenchmarkEnvironment(safe)).toEqual({
      databaseUrl: safe.DATABASE_URL,
      pgrstDatabaseUrl: safe.PGRST_DB_URI,
    })
  })

  it.each([
    [{ ...safe, SHEETBASE_ENV: 'production' }, 'SHEETBASE_ENV'],
    [{ ...safe, SHEETBASE_ENV: 'preview' }, 'SHEETBASE_ENV'],
    [{ ...safe, SHEETBASE_ENV: undefined }, 'SHEETBASE_ENV'],
    [{ ...safe, CORE_DATASET_BENCHMARK_CONFIRM: undefined }, 'confirm'],
    [{ ...safe, CORE_DATASET_BENCHMARK_CONFIRM: 'yes' }, 'confirm'],
    [{ ...safe, DATABASE_URL: undefined }, 'DATABASE_URL'],
    [{ ...safe, DATABASE_URL: 'not-a-url' }, 'DATABASE_URL'],
    [{ ...safe, DATABASE_URL: 'https://localhost/db' }, 'DATABASE_URL'],
    [
      { ...safe, DATABASE_URL: 'postgresql://user:secret@postgres:5432/db' },
      'DATABASE_URL',
    ],
    [
      { ...safe, PGRST_DB_URI: 'postgresql://user:secret@db.example.com/db' },
      'PGRST_DB_URI',
    ],
  ])(
    'rejects unsafe environment %# without exposing the URL',
    (environment, message) => {
      expect(() => assertSafeDatasetBenchmarkEnvironment(environment)).toThrow(
        message,
      )
      try {
        assertSafeDatasetBenchmarkEnvironment(environment)
      } catch (error) {
        expect(String(error)).not.toContain('secret')
      }
    },
  )
})
