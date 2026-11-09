/**
 * Planning and reporting through the /api/db boundary: the study planner,
 * reports, plate designs and analysis views are reachable with a token, act as
 * the person the token belongs to, and leave events the catalogue knows.
 *
 * The suite talks to the running pinned PostgREST and a fresh migrated
 * database, so it exercises the real boundary rather than a stub.
 */
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import * as schema from '#/db/schema'
import {
  createCredential,
  mintApiClientToken,
  mintPersonalApiToken,
} from '#/lib/api-credentials'
import { resolveExternalToken } from '#/lib/external-token'
import { mapEventType } from '#/lib/webhook-events'
import { handleProxyRequest } from '#/lib/postgrest-proxy'

config({ path: ['.env.local', '.env'] })

const WS = '7f000000-0000-4000-8000-000000000001'
const OWNER = 'planning-api-owner'
const SECRET = process.env.PGRST_JWT_SECRET ?? ''

let admin: Client
let database: ReturnType<typeof drizzle<typeof schema>>
let personal: string

function proxy(request: Request, path: string) {
  return handleProxyRequest(request, path, {
    getSession: async () => null,
    getWorkspaceForUser: async () => null,
    mintToken: async () => '',
    resolveExternalToken: (token, method, parsedPath) =>
      resolveExternalToken(database, token, SECRET, method, parsedPath),
    upstreamBaseUrl: process.env.POSTGREST_URL ?? 'http://localhost:3001',
  })
}

function call(path: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  if (init.body) headers.set('content-type', 'application/json')
  return new Request(`http://sheetbase.test/api/db/${path}`, {
    ...init,
    headers,
  })
}

/** Calls an action as the person; returns the decoded answer. */
async function act(name: string, args: Record<string, unknown>) {
  const res = await proxy(
    call(`rpc/${name}`, personal, {
      method: 'POST',
      body: JSON.stringify(args),
      headers: { Prefer: 'return=representation' },
    }),
    `rpc/${name}`,
  )
  const text = await res.text()
  expect([200, 204], `${name}: ${text}`).toContain(res.status)
  return text ? JSON.parse(text) : null
}

async function read(table: string, query = '', token = personal) {
  const res = await proxy(call(`${table}${query}`, token), table)
  expect(res.status, table).toBe(200)
  return (await res.json()) as Array<Record<string, unknown>>
}

beforeAll(async () => {
  if (!SECRET) throw new Error('PGRST_JWT_SECRET is required for API tests.')
  admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await admin.connect()
  database = drizzle(process.env.DATABASE_URL ?? '', { schema })
  await admin.query(
    `INSERT INTO internal."user"(id,name,email,"emailVerified")
     VALUES ($1,'Planning API','planning-api@test.invalid',true)`,
    [OWNER],
  )
  await admin.query(
    `INSERT INTO api.workspaces(id,slug,name) VALUES ($1,'planning-api','Planning API')`,
    [WS],
  )
  await admin.query(
    `INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'owner')`,
    [WS, OWNER],
  )
  const credential = await createCredential(database, {
    workspaceId: WS,
    createdByUserId: OWNER,
    name: 'planning api',
    scopes: ['lab:read', 'lab:write'],
    kind: 'personal',
  })
  personal = await mintPersonalApiToken(SECRET, {
    workspaceId: WS,
    credentialId: credential.id,
    userId: OWNER,
    scopes: ['lab:read', 'lab:write'],
  })
  await admin.query(`SELECT pg_notify('pgrst','reload schema')`)
})

afterAll(async () => {
  if (admin) {
    await admin.end()
    await database.$client.end()
  }
})

describe('planning and reporting over the API', () => {
  it('runs the planner: task, change, moved date, deliverable, snapshot', async () => {
    const task = await act('create_study_task', {
      p_workspace_id: WS,
      p_title: 'Submit the stability data',
      p_task_type: 'milestone',
      p_due_at: '2026-12-01T12:00:00Z',
    })
    expect(task).toMatchObject({
      title: 'Submit the stability data',
      task_type: 'milestone',
      status: 'not_started',
    })

    const edited = await act('edit_study_task', {
      p_task_id: task.id,
      p_status: 'in_progress',
      p_priority: 'high',
    })
    expect(edited).toMatchObject({ status: 'in_progress', priority: 'high' })

    const moved = await act('move_study_task_due', {
      p_task_id: task.id,
      p_expected_metadata_version: edited.metadata_version,
      p_due_at: '2026-12-08T12:00:00Z',
      p_reason: 'The assay was rerun',
    })
    expect(moved.due_at).toContain('2026-12-08')
    const history = await read(
      'study_task_due_changes',
      `?task_id=eq.${task.id}`,
    )
    expect(history).toHaveLength(1)
    expect(history[0].reason).toBe('The assay was rerun')

    const deliverable = await act('create_study_deliverable', {
      p_task_id: task.id,
      p_name: 'Stability report',
    })
    expect(deliverable.name).toBe('Stability report')
    await act('update_study_deliverable', {
      p_id: deliverable.id,
      p_status: 'delivered',
    })
    const rows = await read('study_deliverables', `?task_id=eq.${task.id}`)
    expect(rows[0].status).toBe('delivered')

    const listed = await read('study_tasks', `?id=eq.${task.id}`)
    expect(listed).toHaveLength(1)
    expect(Object.keys(listed[0])).toContain('client_visible')
  })

  it('writes a report and generates it', async () => {
    const report = await act('create_report_definition', {
      p_workspace_id: WS,
      p_title: 'Quarterly stability',
    })
    expect(report.title).toBe('Quarterly stability')
    const section = await act('add_report_section', {
      p_workspace_id: WS,
      p_report_id: report.id,
      p_title: 'Summary',
    })
    expect(section.report_id).toBe(report.id)
    await act('update_report_definition', {
      p_workspace_id: WS,
      p_report_id: report.id,
      p_subtitle: 'Q4',
    })
    const generation = await act('generate_report', {
      p_workspace_id: WS,
      p_report_id: report.id,
    })
    expect(generation.report_id).toBe(report.id)
    const generations = await read(
      'report_generations',
      `?report_id=eq.${report.id}`,
    )
    expect(generations).toHaveLength(1)

    // The document stays out of the event: it can be megabytes.
    const events = await admin.query(
      `SELECT payload FROM api.change_events
        WHERE workspace_id = $1 AND entity_type = 'report_generation'`,
      [WS],
    )
    expect(events.rows).toHaveLength(1)
    expect(events.rows[0].payload).not.toHaveProperty('output_html')
    expect(events.rows[0].payload.output_checksum).toBeTruthy()
  })

  it('designs and archives a plate', async () => {
    const design = await act('create_plate_design', {
      p_workspace_id: WS,
      p_name: 'Dose response A',
    })
    expect(design).toMatchObject({ name: 'Dose response A', status: 'draft' })
    const saved = await act('save_plate_design', {
      p_design_id: design.id,
      p_wells: [],
      p_expected_metadata_version: design.metadata_version,
    })
    const archived = await act('archive_plate_design', {
      p_design_id: design.id,
      p_expected_metadata_version: saved.metadata_version,
    })
    expect(archived.status).toBe('archived')
    expect(await read('plate_designs', `?id=eq.${design.id}`)).toHaveLength(1)
  })

  it('saves, changes and deletes an analysis view as its owner', async () => {
    const view = await act('save_analysis_view', {
      p_id: null,
      p_name: 'Potency',
      p_charts: [{ title: 'Potency' }],
      p_source_revisions: [],
    })
    expect(view).toMatchObject({ name: 'Potency', version: 1 })
    const again = await act('save_analysis_view', {
      p_id: view.id,
      p_name: 'Potency rerun',
      p_charts: [{ title: 'Potency' }],
      p_source_revisions: [],
    })
    expect(again).toMatchObject({ name: 'Potency rerun', version: 2 })
    const status = await act('analysis_view_source_status', {
      p_view_id: view.id,
    })
    expect(status).toBeTruthy()
    await act('delete_analysis_view', { p_id: view.id })
    expect(await read('analysis_views', `?id=eq.${view.id}`)).toHaveLength(0)
  })

  it('turns every change above into an event the catalogue names', async () => {
    const { rows } = await admin.query<{
      entity_type: string
      operation: string
      payload: Record<string, unknown>
    }>(
      `SELECT entity_type, operation, payload FROM api.change_events WHERE workspace_id = $1`,
      [WS],
    )
    const names = new Set(
      rows
        .map((row) => mapEventType(row.entity_type, row.operation, row.payload))
        .filter((name): name is string => name !== null),
    )
    for (const expected of [
      'study.task.created',
      'study.task.updated',
      'study.deliverable.created',
      'study.deliverable.updated',
      'report.created',
      'report.updated',
      'report.generated',
      'plate_design.created',
      'plate_design.updated',
      'analysis_view.created',
      'analysis_view.updated',
      'analysis_view.deleted',
    ])
      expect(names, expected).toContain(expected)
  })

  it('lets a service credential read the workspace, never write as a person', async () => {
    const service = await createCredential(database, {
      workspaceId: WS,
      createdByUserId: OWNER,
      name: 'planning api service',
      scopes: ['lab:read', 'lab:write'],
      kind: 'service',
    })
    const token = await mintApiClientToken(SECRET, {
      workspaceId: WS,
      credentialId: service.id,
      scopes: ['lab:read', 'lab:write'],
    })
    for (const table of [
      'study_tasks',
      'study_workstreams',
      'study_deliverables',
      'report_definitions',
      'report_sections',
      'report_generations',
      'plate_designs',
      'plate_layout_templates',
      'analysis_views',
      'analysis_definitions',
      'milestone_risks',
    ])
      await read(table, '?limit=1', token)
    const res = await proxy(
      call('rpc/create_study_task', token, {
        method: 'POST',
        body: JSON.stringify({ p_workspace_id: WS, p_title: 'No person' }),
      }),
      'rpc/create_study_task',
    )
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
