/** Additive, deterministic month-scale data for Gareth's production workspace. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'

import * as schema from '../schema'
import type { SeedStep } from './run'

const WORKSPACE = '798f250c-99bb-4460-9a2a-e9ec98fbecab'
const GARETH = 'xB46roJKgzg1CEPqF8JmgkvCMilNGHtn'
const EPOCH = new Date('2026-06-28T09:00:00Z')
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

function daysAgo(n: number, hour = 10): Date {
  const d = new Date(EPOCH)
  d.setUTCDate(d.getUTCDate() + n)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}

/** Authenticated connection used by all invariant-enforcing month RPC work. */
export async function authClient(db: Parameters<SeedStep['run']>[0]) {
  const poolUrl = new URL(db.$client.options.connectionString ?? '')
  const pgrst = new URL(process.env.PGRST_DB_URI ?? '')
  if (!pgrst.username) throw new Error('PGRST_DB_URI is required for month seed')
  poolUrl.username = pgrst.username
  poolUrl.password = pgrst.password
  const client = new Client({ connectionString: poolUrl.toString() })
  await client.connect()
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: GARETH, workspace_id: WORKSPACE, role: 'authenticated' }),
  ])
  return {
    client,
    rpc: async <T extends QueryResultRow = Record<string, unknown>>(name: string, params: unknown[]) => {
      if (!/^[a-z_]+$/.test(name)) throw new Error(`Unsafe RPC name: ${name}`)
      const args = params.map((_, i) => `$${i + 1}`).join(',')
      return client.query<T>(`select * from api.${name}(${args})`, params)
    },
    close: () => client.end(),
  }
}

const people = [
  ['Dr. Sarah Chen', 'sarah.chen@sheetbase.test', 'admin'],
  ['Marcus Webb', 'marcus.webb@sheetbase.test', 'scientist'],
  ['Dr. Priya Patel', 'priya.patel@sheetbase.test', 'scientist'],
  ["Tom O'Brien", 'tom.obrien@sheetbase.test', 'member'],
  ['Dr. Anna Kowalski', 'anna.kowalski@sheetbase.test', 'reviewer'],
] as const
const projects = [
  ['cell-therapy', 'CAR-T Cell Therapy Development'],
  ['upstream-process', 'Upstream Process Optimization'],
  ['quality-assurance', 'Quality Assurance & Stability'],
] as const
const experimentTitles = [
  'Transduction efficiency optimization - Batch 001',
  'Stability study week 2 - 4°C storage',
  'Flow cytometry characterization - CD19+ CAR expression',
  'Endotoxin assay - bulk drug substance',
  'Vector copy number by qPCR',
  'Cell viability after thaw',
  'Cytokine release potency assay',
  'Upstream bioreactor pH optimization',
  'Harvest clarification filter screen',
  'Mycoplasma detection - production culture',
  'Transduction efficiency optimization - Batch 002',
  'Stability study week 4 - frozen storage',
  'Flow panel compensation optimization',
  'Residual host-cell DNA assay',
  'Lentiviral infectious titre determination',
  'Media feed strategy comparison',
  'Dissolved oxygen setpoint study',
  'Aseptic process simulation',
  'Identity assay - CAR sequence',
  'Sterility sample preparation',
  'CAR-T expansion kinetics',
  'Cryoprotectant concentration screen',
  'Post-thaw phenotype characterization',
  'Replication competent lentivirus assay',
  'Environmental monitoring trend review',
  'Raw material qualification - serum replacement',
  'Bioburden assay - harvest pool',
  'Stability study week 8 - 4°C storage',
  'Final product release panel',
  'Comparability assessment - process change A',
]

async function upsertCore(db: Parameters<SeedStep['run']>[0]) {
  for (const [i, [name, email, role]] of people.entries()) {
    const id = uuid(0x201 + i)
    await db.insert(schema.user).values({ id, name, email, emailVerified: true }).onConflictDoUpdate({ target: schema.user.id, set: { name, email } })
    await db.insert(schema.workspaceMemberships).values({ workspaceId: WORKSPACE, userId: id, role }).onConflictDoUpdate({ target: [schema.workspaceMemberships.workspaceId, schema.workspaceMemberships.userId], set: { role } })
  }
  for (const [i, [key, title]] of projects.entries()) {
    await db.insert(schema.projects).values({ id: uuid(0x200 + i), workspaceId: WORKSPACE, key, title }).onConflictDoUpdate({ target: [schema.projects.workspaceId, schema.projects.key], set: { title } })
  }

  const records: Array<typeof schema.records.$inferInsert> = []
  experimentTitles.forEach((title, i) => records.push({
    id: uuid(0x300 + i), workspaceId: WORKSPACE, projectId: uuid(0x200 + (i % 3)), kind: 'experiment',
    identifier: `EXP-2026-${String(i + 1).padStart(4, '0')}`, title, status: i < 22 ? 'completed' : 'active',
    tags: ['month-seed', ['cell-therapy', 'upstream', 'qa'][i % 3]], properties: { owner: people[i % 5][0], studyDay: i + 1 },
    createdAt: daysAgo(i), updatedAt: daysAgo(i, 16), createdByUserId: GARETH, updatedByUserId: GARETH,
  }))
  for (let i = 0; i < 10; i++) records.push({
    id: uuid(0x340 + i), workspaceId: WORKSPACE, projectId: uuid(0x200 + (i % 3)), kind: 'sample',
    identifier: `SMP-2026-${String(i + 1).padStart(4, '0')}`, title: `CAR-T process sample ${String(i + 1).padStart(2, '0')}`, status: 'active', tags: ['month-seed'],
    properties: { construct: `CD19-CAR-v${(i % 3) + 1}`, batch: `B26-${101 + i}`, concentration: `${2.1 + i / 10}e6 cells/mL`, storage: i % 2 ? '-80 °C' : '4 °C' },
    createdAt: daysAgo(i * 2), updatedAt: daysAgo(i * 2), createdByUserId: GARETH, updatedByUserId: GARETH,
  })
  const reagentNames = ['Dulbecco’s PBS', 'Human IL-2', 'Anti-CD19 antibody', 'Trypan blue', 'Endotoxin assay reagent']
  for (let i = 0; i < 5; i++) records.push({
    id: uuid(0x350 + i), workspaceId: WORKSPACE, projectId: uuid(0x200 + (i % 3)), kind: 'reagent', identifier: `RGT-2026-${String(i + 1).padStart(4, '0')}`,
    title: reagentNames[i], status: 'active', tags: ['month-seed'], properties: { supplier: ['Thermo Fisher', 'Miltenyi', 'BD', 'Sigma', 'Lonza'][i], lot: `LOT-26${100 + i}`, expiry: `2027-0${i + 2}-28` },
    createdAt: daysAgo(i), updatedAt: daysAgo(i), createdByUserId: GARETH, updatedByUserId: GARETH,
  })
  for (let i = 0; i < 3; i++) records.push({
    id: uuid(0x360 + i), workspaceId: WORKSPACE, projectId: uuid(0x200 + i), kind: 'protocol_template', identifier: `PRT-2026-${String(i + 1).padStart(4, '0')}`,
    title: ['CAR-T transduction workflow', 'Bioreactor sampling procedure', 'Product release testing panel'][i], status: 'validated', tags: ['month-seed', 'controlled'], properties: { version: '1.0' },
    createdAt: daysAgo(i), updatedAt: daysAgo(i), createdByUserId: GARETH, updatedByUserId: GARETH,
  })
  for (let i = 0; i < 10; i++) records.push({
    id: uuid(0x370 + i), workspaceId: WORKSPACE, projectId: uuid(0x200 + (i % 3)), kind: 'file', identifier: `FILE-2026-${String(i + 1).padStart(4, '0')}`,
    title: `assay-results-${String(i + 1).padStart(2, '0')}.csv`, status: 'active', tags: ['month-seed', 'raw-data'], properties: {},
    createdAt: daysAgo(i * 2), updatedAt: daysAgo(i * 2), createdByUserId: GARETH, updatedByUserId: GARETH,
  })
  for (const record of records) await db.insert(schema.records).values(record).onConflictDoUpdate({ target: schema.records.id, set: { title: record.title, status: record.status, properties: record.properties, tags: record.tags, updatedByUserId: GARETH } })

  for (let i = 0; i < 30; i++) {
    const payloads = [
      { type: 'rich_text' as const, payload: { content: [{ type: 'paragraph', content: [{ type: 'text', text: `Objective and observations for ${experimentTitles[i]}. Work performed according to approved SOP.` }] }] } },
      { type: 'materials' as const, payload: { items: [{ id: `sample-${i}`, materialRecordId: uuid(0x340 + (i % 10)), kind: 'sample', identifier: `SMP-2026-${String((i % 10) + 1).padStart(4, '0')}`, title: `CAR-T process sample ${String((i % 10) + 1).padStart(2, '0')}`, quantity: 2, unit: { code: 'mL', symbol: 'mL', quantityKind: 'volume' }, observedAt: daysAgo(i).toISOString() }] } },
      { type: 'checklist' as const, payload: { items: [{ text: 'Verify instrument calibration', checked: true }, { text: 'Review acceptance criteria', checked: i < 22 }] } },
      { type: 'rich_text' as const, payload: { content: [{ type: 'paragraph', content: [{ type: 'text', text: `${i % 2 ? 'Viability' : 'Titer'} result: ${i % 2 ? `${92 + (i % 7)}%` : `${2.8 + i / 10}e9 IU/mL`}.` }] }] } },
      { type: 'callout' as const, payload: { variant: 'info', text: i < 22 ? 'Acceptance criteria met.' : 'Analysis in progress.' } },
    ]
    for (const [j, block] of payloads.entries()) await db.insert(schema.blocks).values({ id: uuid(0x500 + i * 8 + j), recordId: uuid(0x300 + i), type: block.type, payload: block.payload, order: j + 1, createdByUserId: GARETH }).onConflictDoUpdate({ target: schema.blocks.id, set: { payload: block.payload, order: j + 1 } })
  }
  const storage = join(process.cwd(), '.storage', 'objects')
  await mkdir(storage, { recursive: true })
  for (let i = 0; i < 10; i++) {
    const body = `sample,ct,viability\nS${i + 1},${(19.5 + i / 3).toFixed(2)},${94 + (i % 5)}\n`
    const key = `${WORKSPACE}/${uuid(0x370 + i)}/${createHash('md5').update(`month-file-${i}`).digest('hex')}`
    if (i < 4) {
      await mkdir(join(storage, WORKSPACE, uuid(0x370 + i)), { recursive: true })
      await writeFile(join(storage, key), body)
    }
    await db.insert(schema.fileObjects).values({ id: uuid(0x390 + i), workspaceId: WORKSPACE, recordId: uuid(0x370 + i), displayName: `assay-results-${String(i + 1).padStart(2, '0')}.csv`, mediaType: 'text/csv', byteSize: BigInt(Buffer.byteLength(body)), storageKey: key, checksum: createHash('sha256').update(body).digest('hex'), createdByUserId: GARETH, updatedByUserId: GARETH }).onConflictDoUpdate({ target: schema.fileObjects.id, set: { storageKey: key, byteSize: BigInt(Buffer.byteLength(body)) } })
  }
}

async function upsertOperations(db: Parameters<SeedStep['run']>[0]) {
  const auth = await authClient(db)
  try {
    // RPC-created entities are looked up by stable natural keys before creation.
    const resourceDefs = [['QuantStudio 7', 'QS7', 'instrument', 'Analytics Lab', 1], ['BD FACSAria', 'FACS', 'instrument', 'Cell Lab', 1], ['Lab Meeting Room', 'MEET', 'room', 'Building A', 12]] as const
    for (const r of resourceDefs) {
      const found = await auth.client.query('select id from api.calendar_resources where workspace_id=$1 and code=$2', [WORKSPACE, r[1]])
      if (!found.rowCount) await auth.rpc('create_calendar_resource', [WORKSPACE, ...r, 'UTC', null, JSON.stringify({ seeded: 'month' })])
    }
    const resources = (await auth.client.query<{ id: string }>('select id from api.calendar_resources where workspace_id=$1 and code=any($2)', [WORKSPACE, resourceDefs.map((r) => r[1])])).rows
    for (let i = 0; i < 30; i++) {
      const title = `Month seed booking ${String(i + 1).padStart(2, '0')}`
      const exists = await auth.client.query('select 1 from api.calendar_bookings where workspace_id=$1 and title=$2', [WORKSPACE, title])
      if (!exists.rowCount) await auth.rpc('create_booking', [WORKSPACE, resources[i % 3].id, title, daysAgo(i, 8 + (i % 8)), daysAgo(i, 9 + (i % 8)), 'UTC', i % 4 ? 'confirmed' : 'tentative', false, null, ['#2563eb', '#7c3aed', '#059669'][i % 3], 'Realistic month seed booking', uuid(0x200 + (i % 3)), uuid(0x300 + i), JSON.stringify([{ userId: uuid(0x201 + (i % 5)), role: 'participant' }]), '[]'])
    }

    const streams = ['Process Development', 'Analytics & QC', 'Regulatory Documentation', 'Materials Management']
    for (const [i, name] of streams.entries()) {
      const found = await auth.client.query('select id from api.study_workstreams where workspace_id=$1 and name=$2', [WORKSPACE, name])
      if (!found.rowCount) await auth.rpc('create_study_workstream', [WORKSPACE, name, uuid(0x200 + (i % 3)), ['#2563eb', '#7c3aed', '#059669', '#d97706'][i], i])
    }
    const ws = (await auth.client.query<{ id: string }>('select id from api.study_workstreams where workspace_id=$1 and name=any($2)', [WORKSPACE, streams])).rows
    for (let i = 0; i < 40; i++) {
      const title = `Study plan ${String(i + 1).padStart(2, '0')} - ${['culture setup', 'assay execution', 'data review', 'documentation'][i % 4]}`
      const found = await auth.client.query('select 1 from api.study_tasks where workspace_id=$1 and title=$2', [WORKSPACE, title])
      if (!found.rowCount) await auth.rpc('create_study_task', [WORKSPACE, title, i < 5 ? 'milestone' : 'task', ws[i % 4].id, uuid(0x200 + (i % 3)), 'Month-scale process development activity', ['completed', 'in_progress', 'review', 'not_started', 'blocked'][i % 5], ['low', 'medium', 'high', 'critical'][i % 4], i < 5 ? null : daysAgo(i % 28), i < 5 ? null : daysAgo((i % 28) + 2), i < 5 ? daysAgo(5 + i * 5) : daysAgo((i % 28) + 2), 'UTC', i, null, i % 5 === 0 ? 100 : (i % 4) * 25, uuid(0x300 + (i % 30)), null, i % 6 === 0, ['month-seed'], JSON.stringify([{ userId: uuid(0x201 + (i % 5)), role: 'assignee', effortPercent: 50 + (i % 2) * 25 }]), '[]'])
    }
  } finally { await auth.close() }

  const tasks = await db.select({ id: schema.studyTasks.id }).from(schema.studyTasks)
  const monthTasks = tasks.slice(-40)
  for (let i = 0; i < 9 && i + 1 < monthTasks.length; i++) await db.insert(schema.studyTaskDependencies).values({ id: uuid(0xa00 + i), workspaceId: WORKSPACE, predecessorId: monthTasks[i].id, successorId: monthTasks[i + 1].id, createdByUserId: GARETH }).onConflictDoNothing({ target: schema.studyTaskDependencies.id })
  for (let i = 0; i < 5 && i < monthTasks.length; i++) await db.insert(schema.studyDeliverables).values({ id: uuid(0xa20 + i), workspaceId: WORKSPACE, taskId: monthTasks[i].id, name: ['Process development summary', 'QC assay package', 'Regulatory narrative', 'Materials reconciliation', 'Month-end study report'][i], status: i < 3 ? 'delivered' : 'in_progress', dueAt: daysAgo(20 + i) }).onConflictDoUpdate({ target: schema.studyDeliverables.id, set: { status: i < 3 ? 'delivered' : 'in_progress' } })

  // Stable IDs are used here because these rows have no caller-ID RPC and are
  // safely convergent; run telemetry is likewise keyed by source ID.
  await db.insert(schema.instruments).values({ id: uuid(0xb00), workspaceId: WORKSPACE, name: 'BD FACSAria III', instrumentType: 'other', model: 'FACSAria III', serialNumber: 'MONTH-FACS-001', vendor: 'BD Biosciences', createdByUserId: GARETH, updatedByUserId: GARETH }).onConflictDoUpdate({ target: schema.instruments.id, set: { name: 'BD FACSAria III' } })
  for (let i = 0; i < 15; i++) {
    const status = i < 10 ? 'completed' : i < 12 ? 'running' : i === 12 ? 'failed' : 'queued'
    await db.insert(schema.instrumentRuns).values({ id: uuid(0xb20 + i), workspaceId: WORKSPACE, instrumentId: uuid(0xb00), projectId: uuid(0x200 + (i % 3)), name: `Flow cytometry run ${String(i + 1).padStart(2, '0')}`, runIdentifier: `RUN-2026-${String(i + 1).padStart(4, '0')}`, protocolName: 'CAR phenotype panel', plateFormat: '96', operator: people[i % 5][0], status, progressPercent: status === 'completed' ? 100 : status === 'running' ? 55 : 0, startedAt: status === 'queued' ? null : daysAgo(i * 2), completedAt: status === 'completed' || status === 'failed' ? daysAgo(i * 2, 14) : null, createdByUserId: GARETH, updatedByUserId: GARETH }).onConflictDoUpdate({ target: [schema.instrumentRuns.workspaceId, schema.instrumentRuns.runIdentifier], set: { status, progressPercent: status === 'completed' ? 100 : status === 'running' ? 55 : 0 } })
    if (i < 10) {
      await db.insert(schema.instrumentObservations).values({ id: uuid(0xc00 + i), workspaceId: WORKSPACE, runId: uuid(0xb20 + i), sourceId: `month-run-${i + 1}-complete`, observationType: 'run_complete', sourceTimestamp: daysAgo(i * 2, 14), payload: { events: 50000, medianFluorescence: 2450 + i * 40 } }).onConflictDoNothing({ target: schema.instrumentObservations.id })
      await db.insert(schema.instrumentPlateSnapshots).values({ id: uuid(0xc20 + i), workspaceId: WORKSPACE, runId: uuid(0xb20 + i), plateFormat: '96', wells: { A1: { value: 92 + i }, A2: { value: 90 + i } }, capturedAt: daysAgo(i * 2, 13), cycleNumber: 1 }).onConflictDoNothing({ target: schema.instrumentPlateSnapshots.id })
      await db.insert(schema.instrumentQcChecks).values({ id: uuid(0xc40 + i), workspaceId: WORKSPACE, runId: uuid(0xb20 + i), checkName: 'Event count and controls', checkType: i === 7 ? 'warning' : 'pass', message: 'Controls within acceptance criteria', detail: { threshold: 10000 } }).onConflictDoNothing({ target: schema.instrumentQcChecks.id })
      await db.insert(schema.instrumentRawFiles).values({ id: uuid(0xc60 + i), workspaceId: WORKSPACE, runId: uuid(0xb20 + i), filename: `flow-run-${i + 1}.fcs`, mediaType: 'application/octet-stream', sizeBytes: BigInt(102400 + i), storageKey: `month-seed/raw/flow-run-${i + 1}.fcs`, ingestionStatus: 'complete' }).onConflictDoNothing({ target: schema.instrumentRawFiles.id })
    }
  }
}

export const monthSteps: Array<SeedStep> = [
  { name: 'month: people, projects, records, blocks and files', run: upsertCore },
  { name: 'month: calendar, planner and instrument operations', run: upsertOperations },
]
