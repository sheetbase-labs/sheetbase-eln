// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'

import { sweepAuditVerification } from './audit-verification.server'
import { verifyWorkspaces } from './audit-verification'
import type {
  VerificationQueryable,
  VerificationResult,
} from './audit-verification'

// The deployment environment is validated when `env.server` is first imported;
// these are the values this suite needs, set before the imports above run.
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgresql://app:app@localhost:5432/sheetbase'
  process.env.FORMULA_DATABASE_URL =
    'postgresql://app:app@localhost:5432/sheetbase'
  process.env.BETTER_AUTH_SECRET = 'test-secret-at-least-thirty-two-characters'
  process.env.PGRST_JWT_SECRET = 'test-jwt-secret-at-least-thirty-two-chars'
})

const result = (ok: boolean): VerificationResult => ({
  ok,
  chain: { ok, entriesChecked: 10, firstBadSequence: ok ? null : 4 },
  signedRevisions: {
    ok: true,
    checked: 2,
    firstBadSignatureId: null,
    firstBadRevisionId: null,
  },
})

// SAFETY: the sweep makes exactly two statements, and each branch below returns
// the columns its statement selects: id and slug for the queue by age, and the
// recorded verification result for one workspace.
const rowsOf = <T extends QueryResultRow>(rows: QueryResultRow[]): T[] =>
  rows as T[]

/** A connection that answers those two statements and records the calls. */
function fakeDb(workspaces: string[], outcomes: Record<string, boolean>) {
  const calls: Array<{ text: string; values?: unknown[] }> = []

  const query: VerificationQueryable['query'] = async <
    T extends QueryResultRow,
  >(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }> => {
    calls.push({ text, values })

    if (text.includes('from api.workspaces'))
      return {
        rows: rowsOf<T>(workspaces.map((slug) => ({ id: `id-${slug}`, slug }))),
      }

    const slug = String(values?.[0]).replace('id-', '')

    return { rows: rowsOf<T>([{ result: result(outcomes[slug] ?? true) }]) }
  }

  return { query, end: vi.fn(async () => {}), calls }
}

describe('audit verification', () => {
  it('verifies each workspace that is due, in turn', async () => {
    const db = fakeDb(['a', 'b'], {})
    const checked = await verifyWorkspaces(db, 1000)
    expect(checked.map((c) => c.slug)).toEqual(['a', 'b'])
    expect(db.calls).toContainEqual({
      text: expect.stringContaining('api.run_audit_verification'),
      values: ['id-a'],
    })
  })

  it('asks only for workspaces whose last check is older than the limit', async () => {
    const db = fakeDb([], {})
    await verifyWorkspaces(db, 86_400_000)
    expect(db.calls).toContainEqual({
      text: expect.stringContaining('now() - ($1::bigint * interval'),
      values: [86_400_000],
    })
  })

  it('counts a failed check and always closes the connection', async () => {
    const db = fakeDb(['a', 'b'], { b: false })
    await expect(
      sweepAuditVerification({ connect: async () => db }),
    ).resolves.toEqual({ checked: 2, failed: 1 })
    expect(db.end).toHaveBeenCalledTimes(1)
  })
})
