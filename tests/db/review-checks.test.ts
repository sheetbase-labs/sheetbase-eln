/**
 * REV-005 database contract: reviewer check definitions and immutable
 * data-integrity check results. The checks run against frozen revision
 * canonical snapshots — never live data — and the results are write-once.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS_A = '95000000-0000-4000-8000-000000000001'
const WS_B = '95000000-0000-4000-8000-000000000002'
const PROJECT_A = '96000000-0000-4000-8000-000000000001'
const RECORD_A = '97000000-0000-4000-8000-000000000001'
const RECORD_B = '97000000-0000-4000-8000-000000000002'
const OWNER_A = 'rev005-owner-a'
const OWNER_B = 'rev005-owner-b'

let migrator: Client | undefined
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
    session_id: `session-${userId}`,
  })
}

async function authenticated(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    claims(userId, workspaceId),
  ])
  return client
}

/** Insert a revision directly as migrator with a controlled canonical snapshot. */
async function insertRevision(
  recordId: string,
  workspaceId: string,
  snapshot: Record<string, unknown>,
  reason = 'validate',
): Promise<{ id: string; integrityDigest: string }> {
  const { rows } = await migrator!.query(
    `INSERT INTO api.revisions
       (record_id, workspace_id, structure_version, metadata_version,
        metadata_snapshot, block_snapshot, canonical_snapshot,
        integrity_algorithm, reason, created_by_user_id)
     VALUES ($1, $2, 1, 1, $3, $4, $3, 'sha256', $5, $6)
     RETURNING id, integrity_digest`,
    [
      recordId,
      workspaceId,
      JSON.stringify(snapshot),
      JSON.stringify(snapshot.blocks ?? []),
      reason,
      OWNER_A,
    ],
  )
  return { id: rows[0].id, integrityDigest: rows[0].integrity_digest }
}

/** Canonical snapshot where all default checks pass. */
function passingSnapshot(): Record<string, unknown> {
  return {
    formatVersion: 1,
    record: {
      id: RECORD_A,
      workspaceId: WS_A,
      title: 'Complete experiment',
      status: 'draft',
      kind: 'experiment',
    },
    blocks: [
      {
        id: 'b1',
        type: 'rich_text',
        payload: { doc: { type: 'doc', content: [] } },
        order: 100,
      },
    ],
    links: [
      {
        id: 'l1',
        sourceRecordId: RECORD_A,
        targetRecordId: 'file-1',
        linkType: 'file',
      },
    ],
    scientificTables: [
      {
        id: 't1',
        resource_name: 'sheet_aaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'Data table',
        columns: [
          {
            id: 'c1',
            fieldName: 'col_aaaaaaaaaaaaaaaaaaaaaaaaaa',
            label: 'Column A',
            logicalType: 'text',
            displayOrder: 0,
          },
        ],
        rows: [],
      },
    ],
    formulas: [
      {
        id: 'f1',
        status: 'supported',
        version: 1,
        calculation: {
          formula_id: 'f1',
          formula_version: 1,
          status: 'completed',
          result_kind: 'value',
          value: 42,
        },
      },
    ],
    files: [],
  }
}

/** Snapshot with empty title (blocking) and no blocks (warning). */
function failingSnapshot(): Record<string, unknown> {
  return {
    formatVersion: 1,
    record: {
      id: RECORD_A,
      workspaceId: WS_A,
      title: '',
      status: 'draft',
      kind: 'experiment',
    },
    blocks: [],
    links: [],
    scientificTables: [
      {
        id: 't1',
        columns: [
          {
            id: 'c1',
            fieldName: 'col_aaaaaaaaaaaaaaaaaaaaaaaaaa',
            label: 'Bad column',
            logicalType: 'invalid_type',
            displayOrder: 0,
          },
        ],
        rows: [],
      },
    ],
    formulas: [
      {
        id: 'f1',
        status: 'unsupported',
        version: 1,
      },
    ],
    files: [],
  }
}

/** Snapshot with a title (pass) but no blocks and stale formula (both warning). */
function warningSnapshot(): Record<string, unknown> {
  return {
    formatVersion: 1,
    record: {
      id: RECORD_A,
      workspaceId: WS_A,
      title: 'Has title',
      status: 'draft',
      kind: 'experiment',
    },
    blocks: [],
    links: [
      {
        id: 'l1',
        sourceRecordId: RECORD_A,
        targetRecordId: 'file-1',
        linkType: 'file',
      },
    ],
    scientificTables: [],
    formulas: [
      {
        id: 'f1',
        status: 'supported',
        version: 2,
        calculation: {
          formula_id: 'f1',
          formula_version: 1,
          status: 'completed',
        },
      },
    ],
    files: [],
  }
}

async function runChecks(
  client: Client,
  revisionId: string,
  idempotencyKey: string,
  defKey = 'default-scientific-checks',
  defVersion = 1,
) {
  const { rows } = await client.query(
    `SELECT api.run_revision_checks($1, $2, $3, true, $4) AS result`,
    [revisionId, defKey, defVersion, idempotencyKey],
  )
  return rows[0].result as {
    id: string
    overallStatus: string
    passCount: number
    blockingFailureCount: number
    warningFailureCount: number
    infoFailureCount: number
    results: Array<{
      key: string
      category: string
      severity: string
      label: string
      status: string
      evidence: Record<string, unknown>
    }>
    idempotent: boolean
    revisionIntegrityDigest?: string
    checkDefinitionDigest?: string
    inputDigest?: string
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator!.query(
    `INSERT INTO internal."user" (id,name,email,"emailVerified") VALUES
       ($1,'Owner A','owner-a@rev005.test',true),
       ($2,'Owner B','owner-b@rev005.test',true)`,
    [OWNER_A, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
       ($1,'rev005-a','REV005 A'),($2,'rev005-b','REV005 B')`,
    [WS_A, WS_B],
  )
  await migrator!.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
       ($1,$2,'owner'),($3,$4,'owner')`,
    [WS_A, OWNER_A, WS_B, OWNER_B],
  )
  await migrator!.query(
    `INSERT INTO api.projects(id,workspace_id,key,title) VALUES
       ($1,$2,'R05A','REV005 A')`,
    [PROJECT_A, WS_A],
  )
  await migrator!.query(
    `INSERT INTO api.records
       (id,workspace_id,project_id,kind,identifier,title,status,properties,tags,created_by_user_id)
     VALUES
       ($1,$2,$3,'experiment','EXP-R05A','Test experiment','draft','{}','{}',$4),
       ($5,$6,NULL,'experiment','EXP-R05B','Other ws','draft','{}','{}',$7)`,
    [RECORD_A, WS_A, PROJECT_A, OWNER_A, RECORD_B, WS_B, OWNER_B],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator?.end()
})

describe('REV-005 reviewer check definitions and results', () => {
  it('runs all checks against a passing revision and records a pass result', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const rev = await insertRevision(RECORD_A, WS_A, passingSnapshot())
    const result = await runChecks(owner, rev.id, 'check-pass')

    expect(result.idempotent).toBe(false)
    expect(result.overallStatus).toBe('pass')
    expect(result.blockingFailureCount).toBe(0)
    expect(result.warningFailureCount).toBe(0)
    expect(result.passCount).toBe(6)

    // Every item passed.
    for (const item of result.results) {
      expect(item.status).toBe('pass')
    }

    // The result stores the definition version, input digest and revision digest.
    const { rows } = await owner.query(
      `SELECT check_definition_key, check_definition_version,
              revision_integrity_digest, check_definition_digest, input_digest,
              overall_status, results, run_by_user_id
       FROM api.review_check_results WHERE id=$1`,
      [result.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].check_definition_key).toBe('default-scientific-checks')
    expect(rows[0].check_definition_version).toBe(1)
    expect(rows[0].revision_integrity_digest).toBe(rev.integrityDigest)
    expect(rows[0].input_digest).toBe(rev.integrityDigest)
    expect(rows[0].check_definition_digest).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0].run_by_user_id).toBe(OWNER_A)
    expect(rows[0].results).toHaveLength(6)
  })

  it('records a warning when only warning-severity checks fail', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const rev = await insertRevision(RECORD_A, WS_A, warningSnapshot())
    const result = await runChecks(owner, rev.id, 'check-warning')

    expect(result.overallStatus).toBe('warning')
    expect(result.blockingFailureCount).toBe(0)
    expect(result.warningFailureCount).toBe(2)

    // completeness-blocks (warning) fails: no blocks.
    const blocksCheck = result.results.find(
      (r) => r.key === 'completeness-blocks',
    )
    expect(blocksCheck?.status).toBe('fail')
    expect(blocksCheck?.evidence).toMatchObject({ count: 0, minCount: 1 })

    // formula-no-stale-results (warning) fails: version mismatch.
    const staleCheck = result.results.find(
      (r) => r.key === 'formula-no-stale-results',
    )
    expect(staleCheck?.status).toBe('fail')

    // Title check (blocking) passes.
    const titleCheck = result.results.find(
      (r) => r.key === 'completeness-title',
    )
    expect(titleCheck?.status).toBe('pass')
  })

  it('records a fail when blocking checks fail', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const rev = await insertRevision(RECORD_A, WS_A, failingSnapshot())
    const result = await runChecks(owner, rev.id, 'check-fail')

    expect(result.overallStatus).toBe('fail')
    expect(result.blockingFailureCount).toBe(3)
    expect(result.warningFailureCount).toBe(2)

    // completeness-title (blocking) fails.
    const titleCheck = result.results.find(
      (r) => r.key === 'completeness-title',
    )
    expect(titleCheck?.status).toBe('fail')

    // schema-valid-columns (blocking) fails.
    const schemaCheck = result.results.find(
      (r) => r.key === 'schema-valid-columns',
    )
    expect(schemaCheck?.status).toBe('fail')
    expect(schemaCheck?.evidence).toMatchObject({ totalColumns: 1 })

    // formula-supported (blocking) fails.
    const formulaCheck = result.results.find(
      (r) => r.key === 'formula-supported',
    )
    expect(formulaCheck?.status).toBe('fail')
    expect(formulaCheck?.evidence).toMatchObject({ totalFormulas: 1 })

    // required-links (informational) fails — does not affect overall status.
    const linksCheck = result.results.find(
      (r) => r.key === 'required-links',
    )
    expect(linksCheck?.status).toBe('fail')
    expect(result.infoFailureCount).toBe(1)
  })

  it('produces different results when the check definition version changes', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const rev = await insertRevision(RECORD_A, WS_A, failingSnapshot())

    // Insert a v2 definition with only the title check (blocking).
    await migrator!.query(
      `INSERT INTO internal.review_check_definitions (definition_key, version, definition)
       VALUES ('default-scientific-checks', 2, $1)`,
      [
        JSON.stringify({
          checks: [
            {
              key: 'completeness-title',
              category: 'completeness',
              severity: 'blocking',
              label: 'Record has a non-empty title',
              rule: { type: 'completeness-title' },
            },
          ],
        }),
      ],
    )

    const resultV1 = await runChecks(owner, rev.id, 'check-v1')
    const resultV2 = await runChecks(
      owner,
      rev.id,
      'check-v2',
      'default-scientific-checks',
      2,
    )

    // V1 checks 6 items; V2 checks only 1.
    expect(resultV1.results).toHaveLength(6)
    expect(resultV2.results).toHaveLength(1)

    // Both fail (title is empty) but with different failure counts.
    expect(resultV1.blockingFailureCount).toBe(3)
    expect(resultV2.blockingFailureCount).toBe(1)

    // The definition digests differ.
    const { rows } = await owner.query(
      `SELECT check_definition_digest, check_definition_version
       FROM api.review_check_results WHERE id IN ($1, $2)`,
      [resultV1.id, resultV2.id],
    )
    const v1Row = rows.find((r) => r.check_definition_version === 1)
    const v2Row = rows.find((r) => r.check_definition_version === 2)
    expect(v1Row.check_definition_digest).not.toBe(v2Row.check_definition_digest)
  })

  it('returns the same result for an idempotent retry', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const rev = await insertRevision(RECORD_A, WS_A, passingSnapshot())
    const first = await runChecks(owner, rev.id, 'check-idempotent')
    const retry = await runChecks(owner, rev.id, 'check-idempotent')

    expect(retry.idempotent).toBe(true)
    expect(retry.id).toBe(first.id)
  })

  it('prevents updates and deletes of check results', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const rev = await insertRevision(RECORD_A, WS_A, passingSnapshot())
    const result = await runChecks(owner, rev.id, 'check-immutable')

    await expect(
      owner.query(
        `UPDATE api.review_check_results SET overall_status='pass' WHERE id=$1`,
        [result.id],
      ),
    ).rejects.toMatchObject({ code: '42501' })
    await expect(
      owner.query(`DELETE FROM api.review_check_results WHERE id=$1`, [
        result.id,
      ]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('isolates check results by workspace', async () => {
    const ownerA = await authenticated(OWNER_A, WS_A)
    const ownerB = await authenticated(OWNER_B, WS_B)
    const rev = await insertRevision(RECORD_A, WS_A, passingSnapshot())
    await runChecks(ownerA, rev.id, 'check-isolation')

    // Workspace B cannot see workspace A's results.
    const bResults = await ownerB.query(
      `SELECT id FROM api.review_check_results`,
    )
    expect(bResults.rows).toHaveLength(0)

    // Workspace B cannot run checks on workspace A's revision.
    await expect(
      runChecks(ownerB, rev.id, 'check-cross-ws'),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('stores evidence that reviewers can inspect', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const rev = await insertRevision(RECORD_A, WS_A, failingSnapshot())
    const result = await runChecks(owner, rev.id, 'check-evidence')

    // The schema check evidence includes the invalid column details.
    const schemaCheck = result.results.find(
      (r) => r.key === 'schema-valid-columns',
    )
    expect(schemaCheck?.status).toBe('fail')
    const invalidCols = schemaCheck?.evidence.invalidColumns as Array<
      Record<string, unknown>
    >
    expect(invalidCols).toHaveLength(1)
    expect(invalidCols[0]).toMatchObject({ logicalType: 'invalid_type' })

    // The required-links evidence shows missing types.
    const linksCheck = result.results.find(
      (r) => r.key === 'required-links',
    )
    expect(linksCheck?.status).toBe('fail')
    expect(linksCheck?.evidence).toMatchObject({
      requiredLinkTypes: ['file'],
      missingLinkTypes: ['file'],
    })
  })

  it('prevents record or actor deletion from cascading away check results', async () => {
    const owner = await authenticated(OWNER_A, WS_A)
    const rev = await insertRevision(RECORD_A, WS_A, passingSnapshot())
    await runChecks(owner, rev.id, 'check-retention')

    await expect(
      migrator!.query(`DELETE FROM api.records WHERE id=$1`, [RECORD_A]),
    ).rejects.toMatchObject({ code: '23001' })
    await expect(
      migrator!.query(`DELETE FROM internal."user" WHERE id=$1`, [OWNER_A]),
    ).rejects.toMatchObject({ code: '23001' })
  })
})
