// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { sweepAuditVerification } from './audit-verification.server'
import { verifyWorkspaces } from './audit-verification'
import type {
  VerificationQueryable,
  VerificationResult,
} from './audit-verification'

vi.mock('#/env.server', () => ({
  env: { DATABASE_URL: 'postgresql://app:app@localhost:5432/sheetbase' },
}))

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

function fakeDb(workspaces: string[], outcomes: Record<string, boolean>) {
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text.includes('from api.workspaces'))
      return { rows: workspaces.map((slug) => ({ id: `id-${slug}`, slug })) }
    const slug = String(values?.[0]).replace('id-', '')
    return { rows: [{ result: result(outcomes[slug] ?? true) }] }
  })
  return {
    query: query as unknown as VerificationQueryable['query'],
    end: vi.fn(async () => {}),
    calls: query,
  }
}

describe('audit verification', () => {
  it('verifies each workspace that is due, in turn', async () => {
    const db = fakeDb(['a', 'b'], {})
    const checked = await verifyWorkspaces(db, 1000)
    expect(checked.map((c) => c.slug)).toEqual(['a', 'b'])
    expect(db.calls).toHaveBeenCalledWith(
      expect.stringContaining('api.run_audit_verification'),
      ['id-a'],
    )
  })

  it('asks only for workspaces whose last check is older than the limit', async () => {
    const db = fakeDb([], {})
    await verifyWorkspaces(db, 86_400_000)
    expect(db.calls).toHaveBeenCalledWith(
      expect.stringContaining('now() - ($1::bigint * interval'),
      [86_400_000],
    )
  })

  it('counts a failed check and always closes the connection', async () => {
    const db = fakeDb(['a', 'b'], { b: false })
    await expect(
      sweepAuditVerification({ connect: async () => db }),
    ).resolves.toEqual({ checked: 2, failed: 1 })
    expect(db.end).toHaveBeenCalledTimes(1)
  })
})
