import { describe, expect, it } from 'vitest'

import { parseResettableDatabaseUrl } from './reset-guard'

describe('parseResettableDatabaseUrl', () => {
  it('accepts the local development database', () => {
    const target = parseResettableDatabaseUrl(
      'postgresql://sheetbase:sheetbase@localhost:5432/sheetbase',
    )
    expect(target.databaseName).toBe('sheetbase')
    expect(target.maintenanceUrl).toBe(
      'postgresql://sheetbase:sheetbase@localhost:5432/postgres',
    )
  })

  it('accepts the local test database on 127.0.0.1', () => {
    const target = parseResettableDatabaseUrl(
      'postgresql://sheetbase:sheetbase@127.0.0.1:5432/sheetbase_test',
    )
    expect(target.databaseName).toBe('sheetbase_test')
  })

  it('rejects remote hosts', () => {
    expect(() =>
      parseResettableDatabaseUrl(
        'postgresql://user:pass@db.example.com:5432/sheetbase',
      ),
    ).toThrow(/non-local/)
  })

  it('rejects unexpected database names', () => {
    expect(() =>
      parseResettableDatabaseUrl(
        'postgresql://sheetbase:sheetbase@localhost:5432/production',
      ),
    ).toThrow(/Refusing to reset database/)
  })

  it('rejects the maintenance database itself', () => {
    expect(() =>
      parseResettableDatabaseUrl(
        'postgresql://sheetbase:sheetbase@localhost:5432/postgres',
      ),
    ).toThrow(/Refusing to reset database/)
  })

  it('rejects malformed URLs', () => {
    expect(() => parseResettableDatabaseUrl('not-a-url')).toThrow(
      /not a valid URL/,
    )
  })
})
