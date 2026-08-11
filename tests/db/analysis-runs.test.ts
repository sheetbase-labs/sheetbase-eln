import { randomUUID } from 'node:crypto'

import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { expectDenied, prepareTestDatabase } from './helpers'

const workspaceId = randomUUID()
const otherWorkspaceId = randomUUID()
const analysisViewId = randomUUID()
const otherAnalysisViewId = randomUUID()
const ownerId = `analysis-run-owner-${randomUUID()}`
const memberId = `analysis-run-member-${randomUUID()}`
let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let sourceTableId: string
let otherSourceTableId: string
let sourceRecordId: string
const clients: Client[] = []

async function authenticated(
  userId: string,
  activeWorkspaceId = workspaceId,
): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      sub: userId,
      workspace_id: activeWorkspaceId,
      role: 'authenticated',
    }),
  ])
  return client
}

const createSql = `SELECT * FROM api.create_analysis_run(
  $1, 'completed',
  jsonb_build_object(
    'specVersion',1,'type','scatter',
    'datasets',jsonb_build_array(jsonb_build_object('tableId',$2::text)),
    'fields',jsonb_build_object(
      'x',null,
      'y',jsonb_build_object('columnId','11111111-1111-4111-8111-111111111111','fieldName','value'),
      'series',null,'color',null,'size',null
    ),
    'filters','[]'::jsonb,'transformations','[]'::jsonb,
    'display',jsonb_build_object(
      'axes',jsonb_build_object(
        'x',jsonb_build_object('scale','linear'),
        'y',jsonb_build_object('scale','linear')
      ),
      'series','[]'::jsonb
    ),
    'overlays',jsonb_build_object('errorBars',null)
  ),
  '{"state":{"kind":"ok"},"columns":[],"rows":[{"x":1,"y":2}],"series":[],"xLabel":"x","yLabel":"y"}'::jsonb,
  '[]'::jsonb, 'analysis-engine/1'
)`

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
       ($1, 'Analysis owner', $2, true), ($3, 'Analysis member', $4, true)`,
    [
      ownerId,
      `${ownerId}@sheetbase.test`,
      memberId,
      `${memberId}@sheetbase.test`,
    ],
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
       ($1, $2, 'Analysis run test'), ($3, $4, 'Other analysis run test')`,
    [
      workspaceId,
      `analysis-run-${workspaceId}`,
      otherWorkspaceId,
      `analysis-run-${otherWorkspaceId}`,
    ],
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
       ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $2, 'owner')`,
    [workspaceId, ownerId, memberId, otherWorkspaceId],
  )
  const projectId = randomUUID()
  const otherProjectId = randomUUID()
  await migrator.query(
    `INSERT INTO api.projects (id, workspace_id, key, title) VALUES
       ($1,$2,'analysis-run-source','Source'),
       ($3,$4,'analysis-run-other','Other source')`,
    [projectId, workspaceId, otherProjectId, otherWorkspaceId],
  )
  async function createSource(activeWorkspaceId: string, project: string) {
    const owner = await authenticated(ownerId, activeWorkspaceId)
    const record = (
      await owner.query(
        `SELECT * FROM api.create_record($1,'experiment','Analysis source','draft',ARRAY[]::text[],'{}'::jsonb)`,
        [project],
      )
    ).rows[0]
    const block = (
      await owner.query(
        `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
       VALUES($1,'sheet','{}',1,$2) RETURNING id`,
        [record.id, ownerId],
      )
    ).rows[0]
    const tableId = (
      await owner.query(
        `SELECT api.create_scientific_table($1,'Analysis source','[{"label":"Value","logical_type":"decimal"}]') result`,
        [block.id],
      )
    ).rows[0].result.table.id as string
    return { tableId, recordId: record.id as string }
  }
  const source = await createSource(workspaceId, projectId)
  sourceTableId = source.tableId
  sourceRecordId = source.recordId
  otherSourceTableId = (
    await createSource(otherWorkspaceId, otherProjectId)
  ).tableId
  await migrator.query(
    `INSERT INTO api.analysis_views
       (id, workspace_id, owner_user_id, name, spec, source_revisions)
       VALUES ($1, $2, $3, 'Canonical run test', '{}', '[]'),
              ($4, $5, $3, 'Other workspace run test', '{}', '[]')`,
    [
      analysisViewId,
      workspaceId,
      ownerId,
      otherAnalysisViewId,
      otherWorkspaceId,
    ],
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

describe('ANALYSIS-002 canonical analysis runs', () => {
  it('allocates append-only sequences and computes deterministic-looking digests server-side', async () => {
    const owner = await authenticated(ownerId)
    const first = (
      await owner.query(createSql, [analysisViewId, sourceTableId])
    ).rows[0]
    const second = (
      await owner.query(createSql, [analysisViewId, sourceTableId])
    ).rows[0]
    expect([first.sequence, second.sequence]).toEqual([1, 2])
    expect(first.workspace_id).toBe(workspaceId)
    expect(first.actor_user_id).toBe(ownerId)
    expect(first.source_observations).toMatchObject({
      tableId: sourceTableId,
      sourceName: 'Analysis source',
      schemaVersion: 1,
      rowCount: 0,
    })
    expect(first.source_observations.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/)
    expect(second.digest).not.toBe(first.digest)
  })

  it('allows workspace members to read, but only the analysis owner to create', async () => {
    const member = await authenticated(memberId)
    const visible = await member.query(
      'SELECT sequence FROM api.analysis_runs WHERE analysis_view_id=$1 ORDER BY sequence DESC',
      [analysisViewId],
    )
    expect(visible.rows.map((row) => row.sequence)).toEqual([2, 1])
    await expectDenied(
      member.query(createSql, [analysisViewId, sourceTableId]),
      '42501',
    )
  })

  it('binds owner authority to the active workspace', async () => {
    const ownerInOtherWorkspace = await authenticated(ownerId, otherWorkspaceId)
    await expectDenied(
      ownerInOtherWorkspace.query(createSql, [analysisViewId, sourceTableId]),
      '42501',
    )
  })

  it('rejects nonexistent, cross-workspace, and malformed snapshots', async () => {
    const owner = await authenticated(ownerId)
    await expectDenied(
      owner.query(createSql, [analysisViewId, randomUUID()]),
      '22023',
    )
    await expectDenied(
      owner.query(createSql, [analysisViewId, otherSourceTableId]),
      '22023',
    )
    await expectDenied(
      owner.query(
        createSql.replace(
          `'{"state":{"kind":"ok"},"columns":[],"rows":[{"x":1,"y":2}],"series":[],"xLabel":"x","yLabel":"y"}'::jsonb`,
          `'{}'::jsonb`,
        ),
        [analysisViewId, sourceTableId],
      ),
      '22023',
    )
  })

  it('rejects failed states and result shapes that readers cannot render', async () => {
    const owner = await authenticated(ownerId)
    await expectDenied(
      owner.query(createSql.replace("$1, 'completed'", "$1, 'failed'"), [
        analysisViewId,
        sourceTableId,
      ]),
      '22023',
    )
    await expectDenied(
      owner.query(
        createSql.replace("'type','scatter'", "'type','line'"),
        [analysisViewId, sourceTableId],
      ),
      '22023',
    )
    await expectDenied(
      owner.query(createSql.replace("'scale','linear'", "'scale','invalid'"), [
        analysisViewId,
        sourceTableId,
      ]),
      '22023',
    )
    await expectDenied(
      owner.query(
        createSql.replace(
          "'x',jsonb_build_object('scale','linear')",
          "'x',jsonb_build_object('scale','linear','label',42)",
        ),
        [analysisViewId, sourceTableId],
      ),
      '22023',
    )
    await expectDenied(
      owner.query(
        createSql.replace(
          "'y',jsonb_build_object('scale','linear')",
          "'y',jsonb_build_object('scale','linear','unit',null)",
        ),
        [analysisViewId, sourceTableId],
      ),
      '22023',
    )
    await expectDenied(
      owner.query(
        createSql.replace(
          "jsonb_build_object('errorBars',null)",
          "jsonb_build_object('errorBars',jsonb_build_object('columnId','11111111-1111-4111-8111-111111111111','fieldName','value','basis','sd','multiplier',0))",
        ),
        [analysisViewId, sourceTableId],
      ),
      '22023',
    )
    await expectDenied(
      owner.query(
        createSql.replace(
          '"state":{"kind":"ok"}',
          '"state":{"kind":"stale","detail":"changed"}',
        ),
        [analysisViewId, sourceTableId],
      ),
      '22023',
    )
    await expectDenied(
      owner.query(createSql.replace(',"xLabel":"x"', ''), [
        analysisViewId,
        sourceTableId,
      ]),
      '22023',
    )
    await expectDenied(
      owner.query(
        createSql.replace(
          '"series":[],"xLabel"',
          '"series":[{"identifier":"a","label":"A","color":"#000","points":[{}]}],"xLabel"',
        ),
        [analysisViewId, sourceTableId],
      ),
      '22023',
    )
    await expectDenied(
      owner.query(
        createSql.replace(
          '"series":[],"xLabel"',
          '"series":[{"identifier":"a","label":"A","color":"#006EDC","points":[{"x":1,"y":2,"yError":"bad"}]}],"xLabel"',
        ),
        [analysisViewId, sourceTableId],
      ),
      '22023',
    )
  })

  it('validates durable notebook references against the completed run and workspace', async () => {
    const owner = await authenticated(ownerId)
    const run = (
      await owner.query(createSql, [analysisViewId, sourceTableId])
    ).rows[0]
    const payload = JSON.stringify({
      analysisId: analysisViewId,
      runId: run.id,
      title: 'Recorded stability result',
    })
    const inserted = await owner.query(
      `INSERT INTO api.blocks(record_id,type,payload,"order",created_by_user_id)
       VALUES($1,'analysis_reference',$2::jsonb,99,$3) RETURNING id`,
      [sourceRecordId, payload, ownerId],
    )
    expect(inserted.rows).toHaveLength(1)
    await expectDenied(
      owner.query(
        `UPDATE api.blocks SET payload=jsonb_set(payload,'{analysisId}',to_jsonb($1::text))
         WHERE id=$2`,
        [randomUUID(), inserted.rows[0].id],
      ),
      '23514',
    )
    await expectDenied(
      owner.query(
        `UPDATE api.blocks SET payload=payload-'title' WHERE id=$1`,
        [inserted.rows[0].id],
      ),
      '23514',
    )
    const ownerInOtherWorkspace = await authenticated(ownerId, otherWorkspaceId)
    const otherRun = (
      await ownerInOtherWorkspace.query(createSql, [
        otherAnalysisViewId,
        otherSourceTableId,
      ])
    ).rows[0]
    await expectDenied(
      owner.query(
        `UPDATE api.blocks SET payload=$1::jsonb WHERE id=$2`,
        [
          JSON.stringify({
            analysisId: otherAnalysisViewId,
            runId: otherRun.id,
            title: 'Cross-workspace result',
          }),
          inserted.rows[0].id,
        ],
      ),
      '23514',
    )
    await expectDenied(
      owner.query(
        `UPDATE api.blocks SET payload=$1::jsonb WHERE id=$2`,
        [
          JSON.stringify({
            analysisId: analysisViewId,
            runId: randomUUID(),
            title: 'Missing result',
          }),
          inserted.rows[0].id,
        ],
      ),
      '23514',
    )
  })

  it('enforces a nonblank bounded analysis identity name', async () => {
    await expect(
      migrator.query(
        `INSERT INTO api.analysis_views (workspace_id,owner_user_id,name,spec,source_revisions)
       VALUES($1,$2,'   ','{}','[]')`,
        [workspaceId, ownerId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('denies direct inserts and rejects updates and deletes', async () => {
    const owner = await authenticated(ownerId)
    await expectDenied(
      owner.query(
        `INSERT INTO api.analysis_runs
          (workspace_id, analysis_view_id, sequence, actor_user_id, status,
           spec_snapshot, source_observations, result_snapshot, engine_version, digest)
         VALUES ($1,$2,99,$3,'completed','{}','{}','{}','x','bad')`,
        [workspaceId, analysisViewId, ownerId],
      ),
      '42501',
    )
    await expectDenied(
      owner.query(
        'UPDATE api.analysis_runs SET status=$1 WHERE analysis_view_id=$2',
        ['failed', analysisViewId],
      ),
      '42501',
    )
    await expectDenied(
      owner.query('DELETE FROM api.analysis_runs WHERE analysis_view_id=$1', [
        analysisViewId,
      ]),
      '42501',
    )
    await expect(
      migrator.query(
        'UPDATE api.analysis_runs SET status=$1 WHERE analysis_view_id=$2',
        ['failed', analysisViewId],
      ),
    ).rejects.toMatchObject({ code: '55000' })
  })
})
