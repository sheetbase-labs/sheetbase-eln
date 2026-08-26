/**
 * GOV-03 contract proofs: authoritative events exist for every governed
 * object class the audit/history experience surfaces, payloads carry narrow
 * before/after values where humans need them, and `api.audit_events` is
 * permission-aware, workspace-isolated, deterministic in pagination and
 * honest about deleted/archived objects.
 *
 * Covers: dataset / dataset_version / sheet_instance / template /
 * definition triggers; record metadata and file rename before/after;
 * review_submission / signature / review_decision events; audit_events RPC
 * role gating for sensitive classes; cross-workspace isolation; cursor
 * pagination determinism; deleted/archived history honesty.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'
import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'

const DENIED = '42501'

const WS = '00000000-0000-4000-8000-00000000e03a'
const WS_B = '00000000-0000-4000-8000-00000000e03b'
const OWNER = 'gov03-owner'
const MEMBER = 'gov03-member'
const VIEWER = 'gov03-viewer'
const OUTSIDER = 'gov03-outsider'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Array<Client> = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `INSERT INTO internal.user (id, name, email, "emailVerified") VALUES
      ('${OWNER}', 'Gov Owner', 'gov03-o@sheetbase.test', true),
      ('${MEMBER}', 'Gov Member', 'gov03-m@sheetbase.test', true),
      ('${VIEWER}', 'Gov Viewer', 'gov03-v@sheetbase.test', true),
      ('${OUTSIDER}', 'Gov Outsider', 'gov03-x@sheetbase.test', true)`,
  )
  await migrator.query(
    `INSERT INTO api.workspaces (id, slug, name) VALUES
      ('${WS}', 'gov03-ws', 'GOV03 WS'),
      ('${WS_B}', 'gov03-ws-b', 'GOV03 WS B')`,
  )
  await migrator.query(
    `INSERT INTO api.workspace_memberships (workspace_id, user_id, role) VALUES
      ('${WS}', '${OWNER}', 'owner'),
      ('${WS}', '${MEMBER}', 'member'),
      ('${WS}', '${VIEWER}', 'viewer'),
      ('${WS_B}', '${OUTSIDER}', 'owner')`,
  )
})

afterAll(async () => {
  for (const client of clients) await client.end()
  await migrator.end()
})

function claims(userId: string, workspaceId: string): string {
  return JSON.stringify({
    sub: userId,
    workspace_id: workspaceId,
    role: 'authenticated',
    session_id: 'gov03-session',
  })
}

async function asAuthenticated(userId: string, workspaceId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    claims(userId, workspaceId),
  ])
  return client
}

interface AuditEventsResult {
  formatVersion: number
  events: Array<{
    sequence: string
    id: string
    entityType: string
    operation: string
    actorName: string | null
    payload: Record<string, unknown>
  }>
  hasMore: boolean
  nextCursor: number | null
}

async function callAuditEvents(
  client: Client,
  args: Record<string, unknown>,
): Promise<AuditEventsResult> {
  const { rows } = await client.query<{ result: AuditEventsResult }>(
    `SELECT api.audit_events(
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      ) AS result`,
    [
      args.p_entity_type ?? null,
      args.p_operation ?? null,
      args.p_actor_user_id ?? null,
      args.p_from ?? null,
      args.p_to ?? null,
      args.p_search ?? null,
      args.p_object ?? null,
      args.p_before_sequence ?? null,
      args.p_limit ?? 50,
    ],
  )
  return rows[0].result
}

interface RawEvent {
  entity_type: string
  entity_uuid: string
  operation: string
  payload: Record<string, unknown>
}

async function latestEvent(
  entityType: string,
  entityUuid?: string,
): Promise<RawEvent> {
  const { rows } = await migrator.query<RawEvent>(
    `SELECT entity_type, entity_uuid, operation, payload
       FROM api.change_events
      WHERE workspace_id = $1 AND entity_type = $2
        ${entityUuid ? 'AND entity_uuid = $3' : ''}
      ORDER BY sequence DESC LIMIT 1`,
    entityUuid ? [WS, entityType, entityUuid] : [WS, entityType],
  )
  expect(rows.length, `expected a ${entityType} event`).toBe(1)
  return rows[0]
}

describe('GOV-03 trigger coverage', () => {
  it('emits dataset create with identity and rename with before/after', async () => {
    const schemaId = '10000000-0000-4000-8000-0000000e03a1'
    const schemaVersionId = '10000000-0000-4000-8000-0000000e03a2'
    const datasetId = '10000000-0000-4000-8000-0000000e03a3'
    await migrator.query(
      `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name)
       VALUES ('${schemaId}', '${WS}', 'gov03_schema', 'GOV03 Schema')`,
    )
    await migrator.query(
      `INSERT INTO api.dataset_schema_versions (id, schema_id, version)
       VALUES ('${schemaVersionId}', '${schemaId}', 1)`,
    )
    // Datasets are created by trusted paths running outside request claims;
    // seed-style inserts stay quiet by design. Emit through a claims-scoped
    // transaction to prove trigger behaviour under a real session.
    await migrator.query("SELECT set_config('request.jwt.claims', $1, false)", [
      claims(OWNER, WS),
    ])
    await migrator.query(
      `INSERT INTO api.datasets (id, workspace_id, name, description, schema_version_id)
       VALUES ('${datasetId}', '${WS}', 'Assay Yields', 'initial', '${schemaVersionId}')`,
    )
    await migrator.query(
      `UPDATE api.datasets SET name = 'Transduction Yields'
        WHERE id = '${datasetId}'`,
    )

    const { rows } = await migrator.query<RawEvent>(
      `SELECT entity_type, entity_uuid, operation, payload
         FROM api.change_events
        WHERE entity_type = 'dataset' AND entity_uuid = $1
        ORDER BY sequence ASC`,
      [datasetId],
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].operation).toBe('create')
    expect(rows[0].payload.name).toBe('Assay Yields')
    expect(rows[1].operation).toBe('update')
    const changes = rows[1].payload.changes as Record<
      string,
      { from: string; to: string }
    >
    expect(changes.name).toEqual({
      from: 'Assay Yields',
      to: 'Transduction Yields',
    })
  })

  it('emits dataset_version snapshots carrying the parent dataset id', async () => {
    const schemaId = '10000000-0000-4000-8000-0000000e03a9'
    const schemaVersionId = '10000000-0000-4000-8000-0000000e03b0'
    const datasetId = '10000000-0000-4000-8000-0000000e03b5'
    const versionId = '10000000-0000-4000-8000-0000000e03b1'
    await migrator.query(
      `INSERT INTO api.dataset_schema_definitions (id, workspace_id, key, name)
       VALUES ('${schemaId}', '${WS}', 'gov03_schema_b', 'GOV03 Schema B')`,
    )
    await migrator.query(
      `INSERT INTO api.dataset_schema_versions (id, schema_id, version)
       VALUES ('${schemaVersionId}', '${schemaId}', 1)`,
    )
    await migrator.query("SELECT set_config('request.jwt.claims', $1, false)", [
      claims(OWNER, WS),
    ])
    await migrator.query(
      `INSERT INTO api.datasets (id, workspace_id, name, schema_version_id)
       VALUES ('${datasetId}', '${WS}', 'Snapshot Source', '${schemaVersionId}')`,
    )
    await migrator.query(
      `INSERT INTO api.dataset_versions
         (id, dataset_id, workspace_id, schema_version_id, source_dataset_revision, label)
       SELECT '${versionId}', d.id, d.workspace_id, d.schema_version_id,
              d.revision, 'Day 29 freeze'
         FROM api.datasets d WHERE d.id = '${datasetId}'`,
    )
    const event = await latestEvent('dataset_version', versionId)
    expect(event.operation).toBe('create')
    expect(event.payload.datasetId).toBe(datasetId)
    expect(event.payload.label).toBe('Day 29 freeze')
  })

  it('records sheet instance definition upgrades as v-number before/after', async () => {
    const instanceId = '10000000-0000-4000-8000-0000000e03c4'
    const owner = await asAuthenticated(OWNER, WS)

    const created = (
      await owner.query<{
        result: {
          definition: { id: string; revision: number }
          version: { id: string; revision: number; version: number }
        }
      }>(
        `SELECT api.create_sheet_definition($1,'gov03_def','GOV03 Definition',null,$2::jsonb) result`,
        [WS, JSON.stringify(validSheetDefinitionConfiguration())],
      )
    ).rows[0].result

    const published = (
      await owner.query(
        `SELECT api.publish_sheet_definition_version($1,$2) result`,
        [created.version.id, created.version.revision],
      )
    ).rows[0].result as { id: string; version: number; revision: number }

    await owner.query(
      `SELECT api.create_sheet_definition_version($1,$2,$3::jsonb) result`,
      [
        created.definition.id,
        created.definition.revision,
        JSON.stringify(validSheetDefinitionConfiguration()),
      ],
    )
    await owner.query(
      `SELECT api.publish_sheet_definition_version(
         (SELECT id FROM api.sheet_definition_versions
           WHERE definition_id = $1 AND version = 2),
         (SELECT revision FROM api.sheet_definition_versions
           WHERE definition_id = $1 AND version = 2)
       ) result`,
      [created.definition.id],
    )
    const { rows: nextVersion } = await migrator.query<{ id: string }>(
      `SELECT id FROM api.sheet_definition_versions
        WHERE definition_id = $1 AND version = 2`,
      [created.definition.id],
    )

    await migrator.query("SELECT set_config('request.jwt.claims', $1, false)", [
      claims(OWNER, WS),
    ])
    const instanceState = JSON.stringify({
      bindings: [],
      localFields: [],
      localValues: {},
      calculationOverrides: {},
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'compact',
      },
      provenance: { createdFrom: 'definition_version' },
    })
    // INSERT + UPDATE must share one transaction: the controlled-write GUC
    // and the claims GUC are transaction-scoped.
    const instanceIdLiteral = `'${instanceId}'::uuid`
    const wsLiteral = `'${WS}'::uuid`
    const v1Literal = `'${created.version.id}'::uuid`
    const v2Literal = `'${nextVersion[0]?.id}'::uuid`
    await migrator.query(`BEGIN;
      SELECT set_config('request.jwt.claims', '${claims(OWNER, WS).replace(/'/g, "''")}', false);
      SELECT set_config('sheetbase.sheet_instance_write', 'rpc-v1', false);
      SELECT set_config('sheetbase.sheet_instance_upgrade', 'rpc-v1', false);
      INSERT INTO api.sheet_instances
        (id, workspace_id, name, source_definition_version_id, state)
       VALUES (${instanceIdLiteral}, ${wsLiteral}, 'Dilution Grid',
               ${v1Literal}, '${instanceState.replace(/'/g, "''")}'::jsonb);
      UPDATE api.sheet_instances
         SET source_definition_version_id = ${v2Literal}
       WHERE id = ${instanceIdLiteral};
      COMMIT;`)

    const publishEvent = await latestEvent(
      'sheet_definition_version',
      published.id,
    )
    const lifecycleChanges = publishEvent.payload.changes as Record<
      string,
      { from: string; to: string }
    >
    expect(lifecycleChanges.lifecycle).toEqual({
      from: 'draft',
      to: 'published',
    })

    const upgrade = await latestEvent('sheet_instance', instanceId)
    expect(upgrade.operation).toBe('update')
    const changes = upgrade.payload.changes as Record<
      string,
      { from: number; to: number }
    >
    expect(changes.definitionVersion).toEqual({ from: 1, to: 2 })
  })

  it('carries record metadata renames and file display-name renames', async () => {
    const projectId = '10000000-0000-4000-8000-0000000e03d1'
    const recordId = '10000000-0000-4000-8000-0000000e03d2'
    const fileId = '10000000-0000-4000-8000-0000000e03d3'
    await migrator.query(
      `INSERT INTO api.projects (id, workspace_id, key, title)
       VALUES ('${projectId}', '${WS}', 'gov03-proj', 'GOV03 Project')`,
    )
    await migrator.query(
      `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier,
         title, status, created_by_user_id)
       VALUES ('${recordId}', '${WS}', '${projectId}', 'experiment', 'GOV03-001',
               'Baseline Notebook', 'draft', '${MEMBER}')`,
    )
    await migrator.query(
      `INSERT INTO api.file_objects (id, workspace_id, record_id, storage_key,
         display_name, media_type, byte_size)
       VALUES ('${fileId}', '${WS}', '${recordId}', '30000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000002/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               'run1.csv', 'text/csv', 12)`,
    )
    await migrator.query("SELECT set_config('request.jwt.claims', $1, false)", [
      claims(MEMBER, WS),
    ])
    await migrator.query(
      `UPDATE api.records SET title = 'Renamed Notebook', status = 'complete'
        WHERE id = '${recordId}'`,
    )
    await migrator.query(
      `UPDATE api.file_objects SET display_name = 'transduction_run1.csv'
        WHERE id = '${fileId}'`,
    )

    const recordEvents = await migrator.query<RawEvent>(
      `SELECT entity_type, entity_uuid, operation, payload
         FROM api.change_events
        WHERE entity_type = 'record' AND entity_uuid = $1
        ORDER BY sequence ASC`,
      [recordId],
    )
    const update = recordEvents.rows.at(-1)
    expect(update?.payload.changes).toMatchObject({
      title: { from: 'Baseline Notebook', to: 'Renamed Notebook' },
      status: { from: 'draft', to: 'complete' },
    })

    const fileUpdate = await latestEvent('file', fileId)
    const fileChanges = fileUpdate.payload.changes as Record<
      string,
      { from: string; to: string }
    >
    expect(fileChanges.displayName).toEqual({
      from: 'run1.csv',
      to: 'transduction_run1.csv',
    })
  })

  it('emits governance events for submissions, signatures and decisions', async () => {
    const revisionId = '10000000-0000-4000-8000-0000000e03e1'
    const submissionId = '10000000-0000-4000-8000-0000000e03e2'
    const signatureId = '10000000-0000-4000-8000-0000000e03e3'
    const decisionId = '10000000-0000-4000-8000-0000000e03e4'
    const recordId = '10000000-0000-4000-8000-0000000e03d2'
    await migrator.query(
      `INSERT INTO api.revisions (id, record_id, workspace_id, structure_version,
         metadata_version, metadata_snapshot, block_snapshot, integrity_digest,
         reason, created_by_user_id)
       VALUES ('${revisionId}', '${recordId}', '${WS}', 1, 2, '{}'::jsonb,
               '[]'::jsonb, repeat('a', 64), 'submit', '${MEMBER}')`,
    )
    await migrator.query(
      `INSERT INTO internal.review_workflow_definitions (definition_key, version, definition)
       VALUES ('default-review', 1, '{"steps":[]}'::jsonb)
       ON CONFLICT DO NOTHING`,
    )
    await migrator.query(
      `INSERT INTO api.review_submissions (id, workspace_id, record_id, revision_id,
         workflow_definition_key, workflow_definition_version,
         assigned_reviewer_user_ids, submitted_by_user_id, submitted_session_id,
         submitted_role, submitted_at, idempotency_key)
       VALUES ('${submissionId}', '${WS}', '${recordId}', '${revisionId}',
               'default-review', 1, ARRAY['${OWNER}']::text[], '${MEMBER}',
               'sess', 'authenticated', now(), 'gov03-idem-1')`,
    )
    await migrator.query(
      `INSERT INTO api.signatures (id, workspace_id, submission_id, revision_id,
         record_id, signature_meaning, revision_integrity_digest, signer_user_id,
         signer_session_id, signer_role, auth_method, confirmation_phrase)
       VALUES ('${signatureId}', '${WS}', '${submissionId}', '${revisionId}',
               '${recordId}', 'approve-for-record', repeat('a', 64), '${OWNER}',
               'sess', 'authenticated', 'session+name-confirmation', 'Gov Owner')`,
    )
    await migrator.query(
      `INSERT INTO api.review_decisions (id, workspace_id, submission_id,
         revision_id, record_id, decision, revision_integrity_digest,
         actor_user_id, actor_session_id, actor_role)
       VALUES ('${decisionId}', '${WS}', '${submissionId}', '${revisionId}',
               '${recordId}', 'approve', repeat('a', 64), '${OWNER}',
               'sess', 'authenticated')`,
    )

    const submission = await latestEvent('review_submission', submissionId)
    expect(submission.payload.revisionId).toBe(revisionId)

    const signature = await latestEvent('signature', signatureId)
    expect(signature.payload.signatureMeaning).toBe('approve-for-record')
    expect(signature.payload.revisionId).toBe(revisionId)

    const decision = await latestEvent('review_decision', decisionId)
    expect(decision.payload.decision).toBe('approve')
  })
})

describe('api.audit_events permissions and isolation', () => {
  it('hides sensitive security classes from non-steward members but shows them to owner', async () => {
    await migrator.query("SELECT set_config('request.jwt.claims', $1, false)", [
      claims(OWNER, WS),
    ])
    await migrator.query(
      `SELECT internal.emit_change_event_as_actor('${OWNER}', '${WS}',
         'api_credential', gen_random_uuid(), 'create', NULL, NULL,
         '{"name":"svc-key"}'::jsonb)`,
    )

    const memberClient = await asAuthenticated(MEMBER, WS)
    const memberPage = await callAuditEvents(memberClient, {})
    expect(
      memberPage.events.some((event) => event.entityType === 'api_credential'),
    ).toBe(false)

    const ownerClient = await asAuthenticated(OWNER, WS)
    const ownerPage = await callAuditEvents(ownerClient, {})
    const credential = ownerPage.events.find(
      (event) => event.entityType === 'api_credential',
    )
    expect(credential).toBeDefined()
    expect(ownerPage.events.every((event) => event.actorName !== undefined)).toBe(
      true,
    )
  })

  it('allows viewers to read general history but never crosses workspaces', async () => {
    const viewerB = await asAuthenticated(OUTSIDER, WS_B)
    const outsiderPage = await callAuditEvents(viewerB, {})
    expect(outsiderPage.events).toHaveLength(0)

    // Filtering by an object that only exists in WS must not leak rows.
    const { rows: dsRows } = await migrator.query<{ id: string }>(
      `SELECT id FROM api.datasets WHERE workspace_id = $1 LIMIT 1`,
      [WS],
    )
    const leaked = await callAuditEvents(viewerB, { p_object: dsRows[0].id })
    expect(leaked.events).toHaveLength(0)

    const viewer = await asAuthenticated(VIEWER, WS)
    const viewerPage = await callAuditEvents(viewer, {})
    expect(viewerPage.events.length).toBeGreaterThan(0)
    expect(
      viewerPage.events.some((event) => event.entityType === 'dataset'),
    ).toBe(true)
  })

  it('denies callers without human session claims', async () => {
    const client = await asRole('authenticator')
    clients.push(client)
    await client.query('SET ROLE authenticated')
    await client.query(
      "SELECT set_config('request.jwt.claims', $1, false)",
      [
        JSON.stringify({
          sub: MEMBER,
          workspace_id: WS,
          role: 'authenticated',
          // no session_id — service/credential style caller
        }),
      ],
    )
    await expect(callAuditEvents(client, {})).rejects.toMatchObject({
      code: DENIED,
    })

    await client.query('SET ROLE api_client')
    await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
      claims(MEMBER, WS),
    ])
    await expect(callAuditEvents(client, {})).rejects.toMatchObject({
      code: DENIED,
    })
  })
})

describe('same-workspace access differentials (review pass)', () => {
  const PROJECT_D = '10000000-0000-4000-8000-0000000e03d0'
  const RECORD_D = '10000000-0000-4000-8000-0000000e03d1'
  const SUSPENDED = 'gov03-suspended'

  beforeAll(async () => {
    // Owner-owned project + record in WS. Under Sheetbase's canonical rules
    // every governed object's SELECT policy is workspace membership
    // (verified across migrations: 0004/0009/0025/0035/0072/0074/0099), so a
    // second member CAN read them — and therefore their history. The only
    // authoritative intra-workspace visibility differential today is the
    // admin/security event-class gate, pinned here from the member side.
    await migrator.query(
      `INSERT INTO api.projects (id, workspace_id, key, title)
       VALUES ('${PROJECT_D}', '${WS}', 'gov03-d', 'Differential Proj')`,
    )
    await migrator.query(
      `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier,
         title, status, created_by_user_id)
       VALUES ('${RECORD_D}', '${WS}', '${PROJECT_D}',
               'experiment', 'GOV03-D1', 'Differential Notebook',
               'draft', '${OWNER}')`,
    )
    await migrator.query(
      `INSERT INTO internal.user (id, name, email, "emailVerified")
       VALUES ('${SUSPENDED}', 'Gov Suspended', 'gov03-s@sheetbase.test', true)`,
    )
    await migrator.query(
      `INSERT INTO api.workspace_memberships (workspace_id, user_id, role)
       VALUES ('${WS}', '${SUSPENDED}', 'member')`,
    )
  })

  it('follows object reads: another plain member sees governed object history created by someone else', async () => {
    const memberClient = await asAuthenticated(MEMBER, WS)
    const page = await callAuditEvents(memberClient, { p_object: RECORD_D })
    expect(page.events.length).toBeGreaterThan(0)
    expect(
      page.events.some((event) => event.operation === 'create'),
    ).toBe(true)
  })

  it('never exposes admin/security classes to plain members via filters, search or pagination', async () => {
    // A real project_access grant through its canonical RPC — this emits an
    // authoritative change event of the sensitive class.
    const ownerClient = await asAuthenticated(OWNER, WS)
    const grants = (await ownerClient.query<{ id: string }>(
      `SELECT * FROM api.grant_project_access('${WS}'::uuid,
         '${PROJECT_D}'::uuid, '${MEMBER}', 'viewer')`,
    )).rows as Array<{ id: string }>
    expect(grants).toHaveLength(1)

    // Owner sees it; the granted member does not see it even though they are
    // its subject.
    const ownerPage = await callAuditEvents(ownerClient, {
      p_entity_type: 'project_access',
    })
    expect(ownerPage.events.length).toBeGreaterThan(0)

    const memberClient = await asAuthenticated(MEMBER, WS)
    const filtered = await callAuditEvents(memberClient, {
      p_entity_type: 'project_access',
    })
    expect(filtered.events).toHaveLength(0)

    const byObject = await callAuditEvents(memberClient, {
      p_object: PROJECT_D,
    })
    expect(byObject.events.some((e) => e.entityType === 'project_access')).toBe(false)

    // Exhaustive pagination walk: no sensitive class ever materialises and
    // hasMore/cursor arithmetic never counts hidden rows back into view.
    let before: number | null = null
    const seen: string[] = []
    for (let guard = 0; guard < 40; guard += 1) {
      const page = await callAuditEvents(memberClient, {
        p_before_sequence: before ?? undefined,
        p_limit: 2,
      })
      seen.push(...page.events.map((event) => event.entityType))
      if (!page.hasMore) break
      before = Number(page.nextCursor)
      expect(before).not.toBeNull()
    }
    expect(seen.length).toBeGreaterThan(0)
    for (const sensitive of [
      'api_credential',
      'workspace_invitation',
      'workspace_settings',
      'project_access',
    ]) {
      expect(seen).not.toContain(sensitive)
    }
  })

  it('searches ILIKE wildcards literally after escaping', async () => {
    const memberClient = await asAuthenticated(MEMBER, WS)
    const everything = await callAuditEvents(memberClient, {})
    expect(everything.events.length).toBeGreaterThan(0)

    // '%' would match everything as a wildcard; escaped literally it must
    // only match payloads containing a literal percent sign — none exist.
    const percent = await callAuditEvents(memberClient, { p_search: '%' })
    expect(percent.events.length).toBeLessThan(everything.events.length)

    const underscore = await callAuditEvents(memberClient, {
      p_search: '_______',
    })
    expect(underscore.events.length).toBeLessThan(everything.events.length)
  })

  it('fails closed for suspended memberships', async () => {
    await migrator.query(
      `UPDATE api.workspace_memberships SET suspended_at = now()
       WHERE workspace_id = $1 AND user_id = $2`,
      [WS, SUSPENDED],
    )
    const suspendedClient = await asAuthenticated(SUSPENDED, WS)
    await expect(callAuditEvents(suspendedClient, {})).rejects.toMatchObject({
      code: DENIED,
    })
  })
})

describe('api.audit_events pagination and filtering', () => {
  it('paginates deterministically by descending sequence without overlap', async () => {
    const client = await asAuthenticated(OWNER, WS)
    const all = await callAuditEvents(client, { p_limit: 200 })
    expect(all.events.length).toBeGreaterThanOrEqual(3)
    expect(all.hasMore).toBe(false)

    const page1 = await callAuditEvents(client, { p_limit: 2 })
    expect(page1.events).toHaveLength(2)
    expect(page1.hasMore).toBe(true)

    const page2 = await callAuditEvents(client, {
      p_limit: 2,
      p_before_sequence: page1.nextCursor,
    })
    const seq1 = page1.events.map((event) => Number(event.sequence))
    const seq2 = page2.events.map((event) => Number(event.sequence))
    const merged = [...seq1, ...seq2]
    expect(merged).toHaveLength(4)
    expect(merged).toEqual([...merged].sort((a, b) => b - a))
    expect(new Set(merged).size).toBe(4)

    // Cursor pages must reassemble the exact full ordering.
    const tail = await callAuditEvents(client, {
      p_limit: 200,
      p_before_sequence: page2.nextCursor,
    })
    const rebuilt = [
      ...seq1,
      ...seq2,
      ...tail.events.map((e) => Number(e.sequence)),
    ]
    expect(rebuilt).toEqual(all.events.map((e) => Number(e.sequence)))
    expect(tail.hasMore).toBe(false)
  })

  it('filters by object correlation ids recorded in payloads', async () => {
    const client = await asAuthenticated(OWNER, WS)
    const { rows: dsRows } = await migrator.query<{ id: string }>(
      `SELECT id FROM api.datasets WHERE workspace_id = $1 LIMIT 1`,
      [WS],
    )
    const page = await callAuditEvents(client, {
      p_object: dsRows[0].id,
      p_limit: 50,
    })
    expect(page.events.length).toBeGreaterThanOrEqual(2)
    for (const event of page.events) {
      const related =
        event.entityUuid === dsRows[0].id ||
        event.payload['datasetId'] === dsRows[0].id
      expect(related).toBe(true)
    }

    const searched = await callAuditEvents(client, {
      p_search: 'Transduction Yields',
    })
    expect(searched.events.length).toBeGreaterThan(0)
  })
})

describe('history stays honest for archived and deleted objects', () => {
  it('keeps events readable when the record is archived or soft-deleted', async () => {
    const recordId = '10000000-0000-4000-8000-0000000e03f1'
    await migrator.query(
      `INSERT INTO api.projects (id, workspace_id, key, title)
       VALUES ('10000000-0000-4000-8000-0000000e03f9', '${WS}', 'gov03-proj-b', 'Archive Proj')`,
    )
    await migrator.query("SELECT set_config('request.jwt.claims', $1, false)", [
      claims(MEMBER, WS),
    ])
    await migrator.query(
      `INSERT INTO api.records (id, workspace_id, project_id, kind, identifier,
         title, status, created_by_user_id)
       VALUES ('${recordId}', '${WS}', '10000000-0000-4000-8000-0000000e03f9',
               'experiment', 'GOV03-002', 'Doomed Notebook', 'draft', '${MEMBER}')`,
    )
    await migrator.query(`UPDATE api.records SET deleted_at = now() WHERE id = $1`, [
      recordId,
    ])

    const memberClient = await asAuthenticated(MEMBER, WS)
    const page = await callAuditEvents(memberClient, { p_object: recordId })
    expect(page.events.some((event) => event.operation === 'delete' || event.operation === 'create')).toBe(true)
  })
})
