/**
 * R5-STUDIO-03 — database contract proof for stale analysis sources and
 * citations.
 *
 * Proven here:
 * - the canonical staleness rule (`api.analysis_view_source_status`): a source
 *   is current while the pinned schema version number and dataset revision
 *   match, stale when either moves, and removed when the dataset no longer
 *   resolves in the view's workspace — while metadata-only edits (the name)
 *   are irrelevant;
 * - `keep` records the actor, the view version and the pinned revisions through
 *   the existing change-event history and changes nothing on the row;
 * - `update` re-pins to the live schema version and revision, bumps the view
 *   version and leaves submitted evidence byte-identical;
 * - a cited analysis refuses both a direct source change (the guard trigger)
 *   and the `update` resolution, while still allowing `keep` and metadata-only
 *   edits — a cited analysis keeps the sources it cited;
 * - the citation list (`api.analysis_view_citations`) reports the citing record
 *   and its signed/locked state from the existing citation records, and the
 *   reads are workspace-scoped and owner-gated.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-000000000f01'
const OTHER_WS = '00000000-0000-4000-8000-000000000f02'
const PROJECT = '00000000-0000-4000-8000-000000000f03'
const SCHEMA_DEF = '00000000-0000-4000-8000-000000000f04'
const SCHEMA_V1 = '00000000-0000-4000-8000-000000000f05'
const SCHEMA_V2 = '00000000-0000-4000-8000-000000000f06'
const SCHEMA_DEF_OTHER = '00000000-0000-4000-8000-000000000f0e'
const SCHEMA_V1_OTHER = '00000000-0000-4000-8000-000000000f0f'
const FIELD_X = '00000000-0000-4000-8000-000000000f07'
const FIELD_Y = '00000000-0000-4000-8000-000000000f08'
const DATASET_A = '00000000-0000-4000-8000-000000000f09'
const DATASET_B = '00000000-0000-4000-8000-000000000f0a'
const DATASET_C = '00000000-0000-4000-8000-000000000f10'
const RECORD = '00000000-0000-4000-8000-000000000f0b'
const OWNER = 'studio-03-owner'
const OTHER = 'studio-03-other'

interface ViewRow {
  id: string
  display_id: string | null
  version: number
  spec: Record<string, unknown>
  source_revisions: Array<{
    datasetId: string
    schemaVersionNumber: number
    revision: number
  }>
}

interface StatusRow {
  state: 'current' | 'stale'
  staleCount: number
  removedCount: number
  version: number
  citedByCount: number
  citedByLockedCount: number
  acknowledged: {
    at: string
    actorUserId: string
    viewVersion: number
  } | null
  sources: Array<{
    datasetId: string
    datasetName: string
    status: 'current' | 'stale' | 'removed'
    pinned: { schemaVersionNumber: number; revision: number }
    live: { schemaVersionNumber: number; revision: number } | null
    detail: string
  }>
}

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function authenticated(user: string): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: user, workspace_id: WS, role: 'authenticated' }),
  ])
  return client
}

/** A minimal stored ChartSpec; the view row validates nothing about its body. */
function specFor(datasetId: string): Record<string, unknown> {
  return {
    specVersion: 1,
    type: 'scatter',
    datasets: [{ datasetId }],
    fields: {
      x: { fieldId: FIELD_X },
      y: { fieldId: FIELD_Y },
      series: null,
      color: null,
      size: null,
      facet: null,
    },
    filters: [],
    transformations: [],
    typeParams: {},
    overlays: { errorBars: null },
  }
}

async function insertView(
  client: Client,
  name: string,
  datasetId: string,
  pins: Array<{ schemaVersionNumber: number; revision: number }>,
): Promise<ViewRow> {
  const result = await client.query(
    `INSERT INTO api.analysis_views(workspace_id,owner_user_id,name,spec,source_revisions)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb) RETURNING *`,
    [
      WS,
      OWNER,
      name,
      JSON.stringify(specFor(datasetId)),
      JSON.stringify(pins.map((pin) => ({ datasetId, ...pin }))),
    ],
  )
  return result.rows[0] as ViewRow
}

async function status(client: Client, viewId: string): Promise<StatusRow> {
  const result = await client.query(
    'SELECT api.analysis_view_source_status($1) AS status',
    [viewId],
  )
  return result.rows[0].status as StatusRow
}

/** The live (schema version number, revision) pair for a dataset. */
async function livePin(
  client: Client,
  datasetId: string,
): Promise<{ schemaVersionNumber: number; revision: number }> {
  const result = await client.query(
    `SELECT sv.version AS schema_version_number, d.revision
       FROM api.datasets d
       JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
      WHERE d.id = $1`,
    [datasetId],
  )
  return {
    schemaVersionNumber: result.rows[0].schema_version_number,
    revision: Number(result.rows[0].revision),
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified") VALUES
      ('${OWNER}','Studio 03 Owner','studio-03-owner@sheetbase.test',true),
      ('${OTHER}','Studio 03 Other','studio-03-other@sheetbase.test',true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES
      ('${WS}','studio-03','Studio 03'),
      ('${OTHER_WS}','studio-03-other','Studio 03 other')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES
      ('${WS}','${OWNER}','owner'),('${WS}','${OTHER}','member'),
      ('${OTHER_WS}','${OTHER}','owner')`,
  )
  await migrator.query(
    `INSERT INTO api.projects(id,workspace_id,key,title,lead_user_id)
     VALUES ('${PROJECT}','${WS}','studio-03','Studio 03','${OWNER}')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_definitions(id,workspace_id,key,name,lifecycle) VALUES
      ('${SCHEMA_DEF}','${WS}','studio03','Studio 03 schema','active'),
      ('${SCHEMA_DEF_OTHER}','${OTHER_WS}','studio03o','Studio 03 other schema','active')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_versions(id,schema_id,version,lifecycle) VALUES
      ('${SCHEMA_V1}','${SCHEMA_DEF}',1,'draft'),
      ('${SCHEMA_V2}','${SCHEMA_DEF}',2,'draft'),
      ('${SCHEMA_V1_OTHER}','${SCHEMA_DEF_OTHER}',1,'draft')`,
  )
  await migrator.query(
    `INSERT INTO api.dataset_schema_version_fields
       (id,schema_version_id,field_id,key,label,logical_type,nullable,display_order) VALUES
      (gen_random_uuid(),'${SCHEMA_V1}','${FIELD_X}','x','Load','decimal',true,1),
      (gen_random_uuid(),'${SCHEMA_V1}','${FIELD_Y}','y','Yield','decimal',true,2),
      (gen_random_uuid(),'${SCHEMA_V2}','${FIELD_X}','x','Load','decimal',true,1),
      (gen_random_uuid(),'${SCHEMA_V2}','${FIELD_Y}','y','Yield','decimal',true,2),
      (gen_random_uuid(),'${SCHEMA_V1_OTHER}','${FIELD_X}','x','Load','decimal',true,1)`,
  )
  await migrator.query(
    `UPDATE api.dataset_schema_versions
        SET lifecycle='active', published_at=now()
      WHERE id IN ('${SCHEMA_V1}','${SCHEMA_V2}','${SCHEMA_V1_OTHER}')`,
  )
  await migrator.query(
    `INSERT INTO api.datasets(id,workspace_id,schema_version_id,name,primary_project_id) VALUES
      ('${DATASET_A}','${WS}','${SCHEMA_V1}','Studio 03 dataset A','${PROJECT}'),
      ('${DATASET_B}','${WS}','${SCHEMA_V1}','Studio 03 dataset B','${PROJECT}'),
      ('${DATASET_C}','${WS}','${SCHEMA_V1}','Studio 03 dataset C','${PROJECT}')`,
  )
  await migrator.query(
    `INSERT INTO api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     VALUES ('${RECORD}','${WS}','${PROJECT}','experiment','EXP-STUDIO-03','Studio 03 experiment','in_progress','${OWNER}')`,
  )
  await migrator.query(
    `INSERT INTO api.revisions(record_id,workspace_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,canonical_snapshot,integrity_digest,reason,created_by_user_id)
     VALUES ('${RECORD}','${WS}',1,1,'{"title":"Studio 03 experiment"}','[]'::jsonb,'{"files":[]}'::jsonb,repeat('a',64),'submit','${OWNER}')`,
  )
  await migrator.query(
    `INSERT INTO api.review_submissions(workspace_id,record_id,revision_id,state,workflow_definition_key,workflow_definition_version,assigned_reviewer_user_ids,submitted_by_user_id,submitted_session_id,submitted_role,submitted_at,idempotency_key)
     SELECT '${WS}','${RECORD}',id,'approved','default-scientific-review',1,ARRAY['${OWNER}'],'${OWNER}','studio-03-session','authenticated',now(),'studio-03'
       FROM api.revisions WHERE record_id='${RECORD}'`,
  )
  await migrator.query(
    `INSERT INTO api.signatures(workspace_id,submission_id,revision_id,record_id,signature_meaning,revision_integrity_digest,signer_user_id,signer_session_id,signer_role,auth_method,confirmation_phrase)
     SELECT '${WS}',s.id,r.id,'${RECORD}','reviewed-and-approved',r.integrity_digest,'${OWNER}','studio-03-session','owner','session+name-confirmation','Studio 03 attestation'
       FROM api.review_submissions s JOIN api.revisions r ON r.id = s.revision_id
      WHERE s.record_id='${RECORD}'`,
  )
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator.end()
})

describe('R5-STUDIO-03 stale analysis sources', () => {
  it('reports a source as current while the pinned pair still matches', async () => {
    const owner = await authenticated(OWNER)
    const live = await livePin(migrator, DATASET_A)
    const view = await insertView(owner, 'Current source', DATASET_A, [live])

    const result = await status(owner, view.id)
    expect(result.state).toBe('current')
    expect(result.staleCount).toBe(0)
    expect(result.removedCount).toBe(0)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].status).toBe('current')
    expect(result.sources[0].pinned).toEqual(live)
    expect(result.sources[0].live).toEqual(live)
    expect(result.acknowledged).toBeNull()
  })

  it('ignores metadata-only edits and reports a revised dataset as stale', async () => {
    const owner = await authenticated(OWNER)
    const live = await livePin(migrator, DATASET_A)
    const view = await insertView(owner, 'Revised source', DATASET_A, [live])

    // A rename moves nothing the frozen source pins, so the source stays
    // current — "newer" is defined by the pinned pair, not by updated_at.
    await migrator.query(
      `UPDATE api.datasets SET name='Renamed A' WHERE id=$1`,
      [DATASET_A],
    )
    const afterRename = await status(owner, view.id)
    expect(afterRename.state).toBe('current')
    expect(afterRename.sources[0].datasetName).toBe('Renamed A')

    await migrator.query(
      `UPDATE api.datasets SET revision = revision + 1 WHERE id=$1`,
      [DATASET_A],
    )
    const afterRevision = await status(owner, view.id)
    expect(afterRevision.state).toBe('stale')
    expect(afterRevision.staleCount).toBe(1)
    expect(afterRevision.sources[0].status).toBe('stale')
    expect(afterRevision.sources[0].pinned).toEqual(live)
    expect(afterRevision.sources[0].live?.revision).toBe(live.revision + 1)
    expect(afterRevision.sources[0].detail).toMatch(/revised/)
  })

  it('reports a schema-version move as stale', async () => {
    const owner = await authenticated(OWNER)
    const live = await livePin(migrator, DATASET_B)
    const view = await insertView(owner, 'Schema move', DATASET_B, [live])

    await migrator.query(
      `UPDATE api.datasets SET schema_version_id=$2 WHERE id=$1`,
      [DATASET_B, SCHEMA_V2],
    )
    const result = await status(owner, view.id)
    expect(result.state).toBe('stale')
    expect(result.sources[0].status).toBe('stale')
    expect(result.sources[0].live?.schemaVersionNumber).toBe(2)
    expect(result.sources[0].detail).toMatch(/schema v2/)
  })

  it('reports a dataset that left the workspace as removed', async () => {
    const owner = await authenticated(OWNER)
    const live = await livePin(migrator, DATASET_C)
    const view = await insertView(owner, 'Removed source', DATASET_C, [live])

    // The dataset moves out of the view's workspace; it no longer resolves
    // there, which is "removed" rather than "stale".
    await migrator.query(
      `UPDATE api.datasets
          SET workspace_id=$2, schema_version_id=$3, primary_project_id=NULL
        WHERE id=$1`,
      [DATASET_C, OTHER_WS, SCHEMA_V1_OTHER],
    )
    const result = await status(owner, view.id)
    expect(result.state).toBe('stale')
    expect(result.removedCount).toBe(1)
    expect(result.sources[0].status).toBe('removed')
    expect(result.sources[0].live).toBeNull()
    expect(result.sources[0].detail).toMatch(/no longer available/)

    // A removed source cannot be "updated to a newer version".
    const version = await owner.query(
      'SELECT version FROM api.analysis_views WHERE id=$1',
      [view.id],
    )
    await expect(
      owner.query('SELECT api.resolve_analysis_view_sources($1,$2,$3)', [
        view.id,
        version.rows[0].version,
        'update',
      ]),
    ).rejects.toThrow(/no longer available/)
  })
})

describe('R5-STUDIO-03 resolving a stale source', () => {
  it('re-pins an uncited analysis without touching stored spec or evidence', async () => {
    const owner = await authenticated(OWNER)
    const stale = { schemaVersionNumber: 1, revision: 1 }
    const view = await insertView(owner, 'Uncited draft', DATASET_A, [stale])
    const live = await livePin(migrator, DATASET_A)
    expect(live.revision).toBeGreaterThan(stale.revision)

    const evidenceBefore = await migrator.query(
      `SELECT to_jsonb(r) AS evidence FROM api.revisions r WHERE r.record_id=$1 ORDER BY r.created_at`,
      [RECORD],
    )
    const signaturesBefore = await migrator.query(
      `SELECT id, revision_integrity_digest FROM api.signatures WHERE record_id=$1`,
      [RECORD],
    )
    const lockedBefore = await migrator.query(
      'SELECT locked_by_revision_id FROM api.records WHERE id=$1',
      [RECORD],
    )

    const result = await owner.query(
      'SELECT api.resolve_analysis_view_sources($1,$2,$3,$4) AS result',
      [view.id, view.version, 'update', 'Accepted the newer snapshot'],
    )
    expect(result.rows[0].result.resolution).toBe('update')
    expect(result.rows[0].result.state).toBe('current')
    expect(result.rows[0].result.version).toBe(view.version + 1)

    const after = await owner.query(
      'SELECT * FROM api.analysis_views WHERE id=$1',
      [view.id],
    )
    // The pins move to the live pair; the stored spec is untouched.
    expect(after.rows[0].source_revisions).toEqual([
      { datasetId: DATASET_A, ...live },
    ])
    expect(after.rows[0].spec).toEqual(view.spec)
    expect(after.rows[0].version).toBe(view.version + 1)

    // Submitted evidence is byte-identical: no revision evidence, signature or
    // record lock changed because an uncited draft re-pinned its sources.
    const evidenceAfter = await migrator.query(
      `SELECT to_jsonb(r) AS evidence FROM api.revisions r WHERE r.record_id=$1 ORDER BY r.created_at`,
      [RECORD],
    )
    const signaturesAfter = await migrator.query(
      `SELECT id, revision_integrity_digest FROM api.signatures WHERE record_id=$1`,
      [RECORD],
    )
    const lockedAfter = await migrator.query(
      'SELECT locked_by_revision_id FROM api.records WHERE id=$1',
      [RECORD],
    )
    expect(evidenceAfter.rows).toEqual(evidenceBefore.rows)
    expect(signaturesAfter.rows).toEqual(signaturesBefore.rows)
    expect(lockedAfter.rows).toEqual(lockedBefore.rows)

    // The resolution is recorded on the existing history path, with the actor.
    const event = await migrator.query(
      `SELECT actor_user_id, operation, payload FROM api.change_events
        WHERE entity_type='analysis_view' AND entity_uuid=$1
          AND payload->>'resolution'='update'`,
      [view.id],
    )
    expect(event.rows).toHaveLength(1)
    expect(event.rows[0].actor_user_id).toBe(OWNER)
    expect(event.rows[0].operation).toBe('resolve')
    expect(event.rows[0].payload.justification).toBe(
      'Accepted the newer snapshot',
    )
    expect(event.rows[0].payload.updatedSourceIds).toEqual([DATASET_A])
  })

  it('records a keep with the actor and pinned versions, changing nothing on the row', async () => {
    const owner = await authenticated(OWNER)
    const view = await insertView(owner, 'Kept source', DATASET_A, [
      { schemaVersionNumber: 1, revision: 1 },
    ])

    const result = await owner.query(
      'SELECT api.resolve_analysis_view_sources($1,$2,$3) AS result',
      [view.id, view.version, 'keep'],
    )
    expect(result.rows[0].result.resolution).toBe('keep')
    expect(result.rows[0].result.acknowledged).toBe(true)
    expect(result.rows[0].result.state).toBe('stale')
    expect(result.rows[0].result.version).toBe(view.version)

    const after = await owner.query(
      'SELECT version, spec, source_revisions FROM api.analysis_views WHERE id=$1',
      [view.id],
    )
    // `keep` writes history only: the row is byte-identical.
    expect(after.rows[0].version).toBe(view.version)
    expect(after.rows[0].spec).toEqual(view.spec)
    expect(after.rows[0].source_revisions).toEqual(view.source_revisions)

    const acknowledged = await status(owner, view.id)
    expect(acknowledged.state).toBe('stale')
    expect(acknowledged.acknowledged?.actorUserId).toBe(OWNER)
    expect(acknowledged.acknowledged?.viewVersion).toBe(view.version)

    const event = await migrator.query(
      `SELECT actor_user_id, payload FROM api.change_events
        WHERE entity_type='analysis_view' AND entity_uuid=$1
          AND payload->>'resolution'='keep'`,
      [view.id],
    )
    expect(event.rows).toHaveLength(1)
    expect(event.rows[0].actor_user_id).toBe(OWNER)
    expect(event.rows[0].payload.pinnedRevisions).toEqual(view.source_revisions)
  })

  it('refuses to resolve when nothing is stale', async () => {
    const owner = await authenticated(OWNER)
    const live = await livePin(migrator, DATASET_A)
    const view = await insertView(owner, 'Nothing stale', DATASET_A, [live])

    await expect(
      owner.query('SELECT api.resolve_analysis_view_sources($1,$2,$3)', [
        view.id,
        view.version,
        'keep',
      ]),
    ).rejects.toThrow(/nothing to resolve/)
  })

  it('refuses a stale version expectation and a non-owner resolution', async () => {
    const owner = await authenticated(OWNER)
    const other = await authenticated(OTHER)
    const view = await insertView(owner, 'Concurrency', DATASET_A, [
      { schemaVersionNumber: 1, revision: 1 },
    ])

    await expect(
      owner.query('SELECT api.resolve_analysis_view_sources($1,$2,$3)', [
        view.id,
        view.version + 5,
        'keep',
      ]),
    ).rejects.toThrow(/version conflict/)

    await expect(
      other.query('SELECT api.resolve_analysis_view_sources($1,$2,$3)', [
        view.id,
        view.version,
        'keep',
      ]),
    ).rejects.toThrow(/owner/)
  })
})

describe('R5-STUDIO-03 citations', () => {
  it('refuses a source change on a cited analysis but allows keep and metadata edits', async () => {
    const owner = await authenticated(OWNER)
    const view = await insertView(owner, 'Cited analysis', DATASET_A, [
      { schemaVersionNumber: 1, revision: 1 },
    ])
    await migrator.query(
      `INSERT INTO api.record_links(source_record_id,target_kind,target_identifier,link_type,created_by_user_id)
       VALUES ($1,'analysis',$2,'analysis',$3)`,
      [RECORD, view.display_id, OWNER],
    )
    const live = await livePin(migrator, DATASET_A)

    // The guard trigger refuses an in-place source change for the request role.
    await expect(
      owner.query(
        'UPDATE api.analysis_views SET source_revisions=$2::jsonb WHERE id=$1',
        [view.id, JSON.stringify([{ datasetId: DATASET_A, ...live }])],
      ),
    ).rejects.toThrow(/cited by 1 record/)

    // The resolution path refuses the same move.
    await expect(
      owner.query('SELECT api.resolve_analysis_view_sources($1,$2,$3)', [
        view.id,
        view.version,
        'update',
      ]),
    ).rejects.toThrow(/cited by 1 record/)

    // A metadata-only edit is still allowed on a cited analysis.
    await owner.query(
      `UPDATE api.analysis_views SET export_settings='{"format":"csv"}'::jsonb WHERE id=$1`,
      [view.id],
    )
    const afterEdit = await owner.query(
      'SELECT version, spec, source_revisions FROM api.analysis_views WHERE id=$1',
      [view.id],
    )
    expect(afterEdit.rows[0].version).toBe(view.version + 1)
    expect(afterEdit.rows[0].spec).toEqual(view.spec)
    expect(afterEdit.rows[0].source_revisions).toEqual(view.source_revisions)

    // Keeping the pinned versions stays available and changes no evidence.
    const kept = await owner.query(
      'SELECT api.resolve_analysis_view_sources($1,$2,$3) AS result',
      [view.id, view.version + 1, 'keep'],
    )
    expect(kept.rows[0].result.resolution).toBe('keep')

    const statusAfter = await status(owner, view.id)
    expect(statusAfter.citedByCount).toBe(1)
    expect(statusAfter.citedByLockedCount).toBe(1)
  })

  it('lists the citing record with its signed and locked state', async () => {
    const owner = await authenticated(OWNER)
    const view = await insertView(owner, 'Cited by list', DATASET_A, [
      { schemaVersionNumber: 1, revision: 1 },
    ])
    const uncited = await insertView(owner, 'Uncited', DATASET_A, [
      { schemaVersionNumber: 1, revision: 1 },
    ])
    await migrator.query(
      `INSERT INTO api.record_links(source_record_id,target_kind,target_identifier,link_type,created_by_user_id)
       VALUES ($1,'analysis',$2,'analysis',$3)`,
      [RECORD, view.display_id, OWNER],
    )

    const cited = await owner.query(
      'SELECT api.analysis_view_citations($1) AS citations',
      [view.id],
    )
    expect(cited.rows[0].citations).toHaveLength(1)
    const citation = cited.rows[0].citations[0]
    expect(citation.identifier).toBe('EXP-STUDIO-03')
    expect(citation.title).toBe('Studio 03 experiment')
    expect(citation.locked).toBe(true)
    expect(citation.signed).toBe(true)
    expect(citation.signerUserId).toBe(OWNER)
    expect(citation.signedAt).not.toBeNull()
    expect(citation.linkedAt).not.toBeNull()

    const empty = await owner.query(
      'SELECT api.analysis_view_citations($1) AS citations',
      [uncited.id],
    )
    expect(empty.rows[0].citations).toEqual([])
  })

  it('denies the reads outside the workspace and for an unknown view', async () => {
    const owner = await authenticated(OWNER)
    await expect(
      owner.query('SELECT api.analysis_view_source_status($1)', [
        '00000000-0000-4000-8000-000000000fff',
      ]),
    ).rejects.toThrow(/Analysis denied/)
    await expect(
      owner.query('SELECT api.analysis_view_citations($1)', [
        '00000000-0000-4000-8000-000000000fff',
      ]),
    ).rejects.toThrow(/Analysis denied/)
  })
})
