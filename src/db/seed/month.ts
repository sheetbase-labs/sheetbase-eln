/** Additive, deterministic month-scale data for Gareth's production workspace. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import type { QueryResultRow } from 'pg'

import * as schema from '../schema'
import { eq, sql } from 'drizzle-orm'
import type { SeedStep } from './run'

const WORKSPACE = '798f250c-99bb-4460-9a2a-e9ec98fbecab'
// Resolved at seed time to the actual workspace owner (the logged-in user).
// This ensures dashboard queries (which filter by current user) match seeded data.
let GARETH = 'xB46roJKgzg1CEPqF8JmgkvCMilNGHtn'
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
  if (!pgrst.username)
    throw new Error('PGRST_DB_URI is required for month seed')
  poolUrl.username = pgrst.username
  poolUrl.password = pgrst.password
  const client = new Client({ connectionString: poolUrl.toString() })
  await client.connect()
  await client.query('SET ROLE authenticated')
  await client.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({
      sub: GARETH,
      workspace_id: WORKSPACE,
      role: 'authenticated',
    }),
  ])
  return {
    client,
    rpc: async <T extends QueryResultRow = Record<string, unknown>>(
      name: string,
      params: unknown[],
    ) => {
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
  // Resolve the actual workspace owner (the OAuth-logged-in user, not the
  // hardcoded seed ID) so seeded data is visible in the dashboard.
  const oldGareth = GARETH
  const ownerRow = await db
    .select({ userId: schema.workspaceMemberships.userId })
    .from(schema.workspaceMemberships)
    .where(
      sql`${schema.workspaceMemberships.workspaceId} = ${WORKSPACE} AND ${schema.workspaceMemberships.role} = 'owner' AND ${schema.workspaceMemberships.userId} != ${oldGareth}`,
    )
    .limit(1)
  if (ownerRow[0]?.userId && ownerRow[0].userId !== GARETH) {
    // Migrate existing data from the old hardcoded user ID to the actual workspace owner.
    // Bypass triggers (some records may be locked by reviews). session_replication_role
    // is restored in a finally block so a failing UPDATE never leaves triggers disabled.
    const newGareth = ownerRow[0].userId
    await db.execute(sql`SET session_replication_role = replica`)
    try {
      await db.execute(
        sql`UPDATE api.records SET created_by_user_id = ${newGareth}, updated_by_user_id = ${newGareth} WHERE workspace_id = ${WORKSPACE} AND created_by_user_id = ${GARETH}`,
      )
      await db.execute(
        sql`UPDATE api.blocks SET created_by_user_id = ${newGareth} WHERE created_by_user_id = ${GARETH} AND record_id IN (SELECT id FROM api.records WHERE workspace_id = ${WORKSPACE})`,
      )
      await db.execute(
        sql`UPDATE api.change_events SET actor_user_id = ${newGareth} WHERE workspace_id = ${WORKSPACE} AND actor_user_id = ${GARETH}`,
      )
      await db.execute(
        sql`UPDATE api.review_submissions SET submitted_by_user_id = ${newGareth} WHERE submitted_by_user_id = ${GARETH}`,
      )
      await db.execute(
        sql`UPDATE api.review_submissions SET assigned_reviewer_user_ids = array_replace(assigned_reviewer_user_ids, ${GARETH}, ${newGareth}) WHERE ${GARETH} = ANY(assigned_reviewer_user_ids)`,
      )
      await db.execute(
        sql`UPDATE api.comments SET mentions = array_replace(mentions, ${GARETH}, ${newGareth}) WHERE ${GARETH} = ANY(mentions)`,
      )
    } finally {
      await db.execute(sql`SET session_replication_role = DEFAULT`)
    }
    GARETH = newGareth
  }

  for (const [i, [name, email, role]] of people.entries()) {
    const id = uuid(0x201 + i)
    await db
      .insert(schema.user)
      .values({ id, name, email, emailVerified: true })
      .onConflictDoUpdate({ target: schema.user.id, set: { name, email } })
    await db
      .insert(schema.workspaceMemberships)
      .values({ workspaceId: WORKSPACE, userId: id, role })
      .onConflictDoUpdate({
        target: [
          schema.workspaceMemberships.workspaceId,
          schema.workspaceMemberships.userId,
        ],
        set: { role },
      })
  }
  for (const [i, [key, title]] of projects.entries()) {
    await db
      .insert(schema.projects)
      .values({ id: uuid(0x200 + i), workspaceId: WORKSPACE, key, title })
      .onConflictDoUpdate({
        target: [schema.projects.workspaceId, schema.projects.key],
        set: { title },
      })
  }

  const records: Array<typeof schema.records.$inferInsert> = []
  experimentTitles.forEach((title, i) =>
    records.push({
      id: uuid(0x300 + i),
      workspaceId: WORKSPACE,
      projectId: uuid(0x200 + (i % 3)),
      kind: 'experiment',
      identifier: `EXP-2026-${String(i + 1).padStart(4, '0')}`,
      title,
      status: i < 22 ? 'completed' : 'active',
      tags: ['month-seed', ['cell-therapy', 'upstream', 'qa'][i % 3]],
      properties: { owner: people[i % 5][0], studyDay: i + 1 },
      createdAt: daysAgo(i),
      updatedAt: daysAgo(i, 16),
      createdByUserId: GARETH,
      updatedByUserId: GARETH,
    }),
  )
  for (let i = 0; i < 10; i++)
    records.push({
      id: uuid(0x340 + i),
      workspaceId: WORKSPACE,
      projectId: uuid(0x200 + (i % 3)),
      kind: 'sample',
      identifier: `SMP-2026-${String(i + 1).padStart(4, '0')}`,
      title: `CAR-T process sample ${String(i + 1).padStart(2, '0')}`,
      status: 'active',
      tags: ['month-seed'],
      properties: {
        construct: `CD19-CAR-v${(i % 3) + 1}`,
        batch: `B26-${101 + i}`,
        concentration: `${2.1 + i / 10}e6 cells/mL`,
        storage: i % 2 ? '-80 °C' : '4 °C',
      },
      createdAt: daysAgo(i * 2),
      updatedAt: daysAgo(i * 2),
      createdByUserId: GARETH,
      updatedByUserId: GARETH,
    })
  const reagentNames = [
    'Dulbecco’s PBS',
    'Human IL-2',
    'Anti-CD19 antibody',
    'Trypan blue',
    'Endotoxin assay reagent',
  ]
  for (let i = 0; i < 5; i++)
    records.push({
      id: uuid(0x350 + i),
      workspaceId: WORKSPACE,
      projectId: uuid(0x200 + (i % 3)),
      kind: 'reagent',
      identifier: `RGT-2026-${String(i + 1).padStart(4, '0')}`,
      title: reagentNames[i],
      status: 'active',
      tags: ['month-seed'],
      properties: {
        supplier: ['Thermo Fisher', 'Miltenyi', 'BD', 'Sigma', 'Lonza'][i],
        lot: `LOT-26${100 + i}`,
        expiry: `2027-0${i + 2}-28`,
      },
      createdAt: daysAgo(i),
      updatedAt: daysAgo(i),
      createdByUserId: GARETH,
      updatedByUserId: GARETH,
    })
  for (let i = 0; i < 3; i++)
    records.push({
      id: uuid(0x360 + i),
      workspaceId: WORKSPACE,
      projectId: uuid(0x200 + i),
      kind: 'protocol_template',
      identifier: `PRT-2026-${String(i + 1).padStart(4, '0')}`,
      title: [
        'CAR-T transduction workflow',
        'Bioreactor sampling procedure',
        'Product release testing panel',
      ][i],
      status: 'validated',
      tags: ['month-seed', 'controlled'],
      properties: { version: '1.0' },
      createdAt: daysAgo(i),
      updatedAt: daysAgo(i),
      createdByUserId: GARETH,
      updatedByUserId: GARETH,
    })
  for (let i = 0; i < 10; i++)
    records.push({
      id: uuid(0x370 + i),
      workspaceId: WORKSPACE,
      projectId: uuid(0x200 + (i % 3)),
      kind: 'file',
      identifier: `FILE-2026-${String(i + 1).padStart(4, '0')}`,
      title: `assay-results-${String(i + 1).padStart(2, '0')}.csv`,
      status: 'active',
      tags: ['month-seed', 'raw-data'],
      properties: {},
      createdAt: daysAgo(i * 2),
      updatedAt: daysAgo(i * 2),
      createdByUserId: GARETH,
      updatedByUserId: GARETH,
    })
  for (const record of records)
    await db
      .insert(schema.records)
      .values(record)
      .onConflictDoNothing({ target: schema.records.id })

  for (let i = 0; i < 30; i++) {
    // Skip block creation if blocks already exist (records may be locked by revisions)
    const existingBlocks = await db
      .select({ id: schema.blocks.id })
      .from(schema.blocks)
      .where(eq(schema.blocks.recordId, uuid(0x300 + i)))
      .limit(1)
    if (existingBlocks.length > 0) continue
    const richTextDoc = (content: unknown[]) => ({
      doc: { type: 'doc' as const, content },
    })
    const paragraph = (text: string) => ({
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text }],
    })
    const heading = (level: 2 | 3, text: string) => ({
      type: 'heading' as const,
      attrs: { level },
      content: [{ type: 'text' as const, text }],
    })
    const isViability = i % 2 === 1
    const resultValue = isViability
      ? `${92 + (i % 7)}%`
      : `${(2.8 + i / 10).toFixed(1)}e9 IU/mL`
    const payloads = [
      {
        type: 'rich_text' as const,
        payload: richTextDoc([
          heading(2, 'Objective'),
          paragraph(
            `Objective and observations for ${experimentTitles[i]}. Work performed according to approved SOP.`,
          ),
        ]),
      },
      {
        type: 'materials' as const,
        payload: {
          items: [
            {
              id: `sample-${i}`,
              materialRecordId: uuid(0x340 + (i % 10)),
              kind: 'sample' as const,
              identifier: `SMP-2026-${String((i % 10) + 1).padStart(4, '0')}`,
              title: `CAR-T process sample ${String((i % 10) + 1).padStart(2, '0')}`,
              quantity: 2,
              unit: { code: 'mL', symbol: 'mL', quantityKind: 'volume' },
              observedAt: daysAgo(i).toISOString(),
            },
          ],
        },
      },
      {
        type: 'checklist' as const,
        payload: {
          items: [
            { text: 'Verify instrument calibration', checked: true },
            { text: 'Review acceptance criteria', checked: i < 22 },
            { text: 'Record raw data in ELN', checked: i < 22 },
            { text: 'Submit for review', checked: i < 22 },
          ],
        },
      },
      {
        type: 'rich_text' as const,
        payload: richTextDoc([
          heading(3, 'Results'),
          paragraph(
            `${isViability ? 'Viability' : 'Titer'} result: ${resultValue}.`,
          ),
        ]),
      },
      {
        type: 'callout' as const,
        payload: {
          variant: i < 22 ? 'info' : 'warning',
          text: i < 22 ? 'Acceptance criteria met.' : 'Analysis in progress.',
        },
      },
      {
        type: 'metric' as const,
        payload: {
          label: isViability ? 'Cell viability' : 'Vector titer',
          value: isViability ? 92 + (i % 7) : +(2.8 + i / 10).toFixed(1),
          unit: isViability ? '%' : 'e9 IU/mL',
          provenance: 'qPCR — QuantStudio 7',
        },
      },
      {
        type: 'table' as const,
        payload: {
          columns: [
            'Replicate',
            isViability ? 'Viability (%)' : 'Titer (e9 IU/mL)',
            'Ct',
          ],
          rows: [
            [
              '1',
              isViability ? String(92 + (i % 7)) : (2.8 + i / 10).toFixed(1),
              (19.5 + i / 3).toFixed(2),
            ],
            [
              '2',
              isViability ? String(91 + (i % 7)) : (2.7 + i / 10).toFixed(1),
              (19.8 + i / 3).toFixed(2),
            ],
            [
              '3',
              isViability ? String(93 + (i % 7)) : (2.9 + i / 10).toFixed(1),
              (19.2 + i / 3).toFixed(2),
            ],
          ],
        },
      },
      {
        type: 'linked_record' as const,
        payload: {
          targetKind: 'experiment',
          targetIdentifier: `EXP-2026-${String(((i + 9) % 30) + 1).padStart(4, '0')}`,
          linkType: 'general',
          label: experimentTitles[(i + 9) % 30],
        },
      },
    ]
    for (const [j, block] of payloads.entries())
      await db
        .insert(schema.blocks)
        .values({
          id: uuid(0x500 + i * 8 + j),
          recordId: uuid(0x300 + i),
          type: block.type,
          payload: block.payload,
          order: j + 1,
          createdByUserId: GARETH,
        })
        .onConflictDoNothing({ target: schema.blocks.id })
  }
  const storage = join(process.cwd(), '.storage', 'objects')
  await mkdir(storage, { recursive: true })
  for (let i = 0; i < 10; i++) {
    const body = `sample,ct,viability\nS${i + 1},${(19.5 + i / 3).toFixed(2)},${94 + (i % 5)}\n`
    const key = `${WORKSPACE}/${uuid(0x370 + i)}/${createHash('md5').update(`month-file-${i}`).digest('hex')}`
    if (i < 4) {
      await mkdir(join(storage, WORKSPACE, uuid(0x370 + i)), {
        recursive: true,
      })
      await writeFile(join(storage, key), body)
    }
    await db
      .insert(schema.fileObjects)
      .values({
        id: uuid(0x390 + i),
        workspaceId: WORKSPACE,
        recordId: uuid(0x370 + i),
        displayName: `assay-results-${String(i + 1).padStart(2, '0')}.csv`,
        mediaType: 'text/csv',
        byteSize: BigInt(Buffer.byteLength(body)),
        storageKey: key,
        checksum: createHash('sha256').update(body).digest('hex'),
        createdByUserId: GARETH,
        updatedByUserId: GARETH,
      })
      .onConflictDoUpdate({
        target: schema.fileObjects.id,
        set: { storageKey: key, byteSize: BigInt(Buffer.byteLength(body)) },
      })
  }
}

async function upsertOperations(db: Parameters<SeedStep['run']>[0]) {
  const auth = await authClient(db)
  try {
    // RPC-created entities are looked up by stable natural keys before creation.
    const resourceDefs = [
      ['QuantStudio 7', 'QS7', 'instrument', 'Analytics Lab', 1],
      ['BD FACSAria', 'FACS', 'instrument', 'Cell Lab', 1],
      ['Lab Meeting Room', 'MEET', 'room', 'Building A', 12],
    ] as const
    for (const r of resourceDefs) {
      const found = await auth.client.query(
        'select id from api.calendar_resources where workspace_id=$1 and code=$2',
        [WORKSPACE, r[1]],
      )
      if (!found.rowCount)
        await auth.rpc('create_calendar_resource', [
          WORKSPACE,
          ...r,
          'UTC',
          null,
          JSON.stringify({ seeded: 'month' }),
        ])
    }
    const resources = (
      await auth.client.query<{ id: string }>(
        'select id from api.calendar_resources where workspace_id=$1 and code=any($2)',
        [WORKSPACE, resourceDefs.map((r) => r[1])],
      )
    ).rows
    for (let i = 0; i < 30; i++) {
      const title = `Month seed booking ${String(i + 1).padStart(2, '0')}`
      const exists = await auth.client.query(
        'select 1 from api.calendar_bookings where workspace_id=$1 and title=$2',
        [WORKSPACE, title],
      )
      if (!exists.rowCount)
        await auth.rpc('create_booking', [
          WORKSPACE,
          resources[i % 3].id,
          title,
          daysAgo(i, 8 + (i % 8)),
          daysAgo(i, 9 + (i % 8)),
          'UTC',
          i % 4 ? 'confirmed' : 'tentative',
          false,
          null,
          ['#2563eb', '#7c3aed', '#059669'][i % 3],
          'Realistic month seed booking',
          uuid(0x200 + (i % 3)),
          uuid(0x300 + i),
          JSON.stringify([
            { userId: uuid(0x201 + (i % 5)), role: 'participant' },
          ]),
          '[]',
        ])
    }

    const streams = [
      'Process Development',
      'Analytics & QC',
      'Regulatory Documentation',
      'Materials Management',
    ]
    for (const [i, name] of streams.entries()) {
      const found = await auth.client.query(
        'select id from api.study_workstreams where workspace_id=$1 and name=$2',
        [WORKSPACE, name],
      )
      if (!found.rowCount)
        await auth.rpc('create_study_workstream', [
          WORKSPACE,
          name,
          uuid(0x200 + (i % 3)),
          ['#2563eb', '#7c3aed', '#059669', '#d97706'][i],
          i,
        ])
    }
    const ws = (
      await auth.client.query<{ id: string }>(
        'select id from api.study_workstreams where workspace_id=$1 and name=any($2)',
        [WORKSPACE, streams],
      )
    ).rows
    for (let i = 0; i < 40; i++) {
      const title = `Study plan ${String(i + 1).padStart(2, '0')} - ${['culture setup', 'assay execution', 'data review', 'documentation'][i % 4]}`
      const found = await auth.client.query(
        'select 1 from api.study_tasks where workspace_id=$1 and title=$2',
        [WORKSPACE, title],
      )
      if (!found.rowCount)
        await auth.rpc('create_study_task', [
          WORKSPACE,
          title,
          i < 5 ? 'milestone' : 'task',
          ws[i % 4].id,
          uuid(0x200 + (i % 3)),
          'Month-scale process development activity',
          ['completed', 'in_progress', 'review', 'not_started', 'blocked'][
            i % 5
          ],
          ['low', 'medium', 'high', 'critical'][i % 4],
          i < 5 ? null : daysAgo(i % 28),
          i < 5 ? null : daysAgo((i % 28) + 2),
          i < 5 ? daysAgo(5 + i * 5) : daysAgo((i % 28) + 2),
          'UTC',
          i,
          null,
          i % 5 === 0 ? 100 : (i % 4) * 25,
          uuid(0x300 + (i % 30)),
          null,
          i % 6 === 0,
          ['month-seed'],
          JSON.stringify([
            {
              userId: uuid(0x201 + (i % 5)),
              role: 'assignee',
              effortPercent: 50 + (i % 2) * 25,
            },
          ]),
          '[]',
        ])
    }
  } finally {
    await auth.close()
  }

  const tasks = await db
    .select({ id: schema.studyTasks.id })
    .from(schema.studyTasks)
  const monthTasks = tasks.slice(-40)
  for (let i = 0; i < 9 && i + 1 < monthTasks.length; i++)
    await db
      .insert(schema.studyTaskDependencies)
      .values({
        id: uuid(0xa00 + i),
        workspaceId: WORKSPACE,
        predecessorId: monthTasks[i].id,
        successorId: monthTasks[i + 1].id,
        createdByUserId: GARETH,
      })
      .onConflictDoNothing({ target: schema.studyTaskDependencies.id })
  for (let i = 0; i < 5 && i < monthTasks.length; i++)
    await db
      .insert(schema.studyDeliverables)
      .values({
        id: uuid(0xa20 + i),
        workspaceId: WORKSPACE,
        taskId: monthTasks[i].id,
        name: [
          'Process development summary',
          'QC assay package',
          'Regulatory narrative',
          'Materials reconciliation',
          'Month-end study report',
        ][i],
        status: i < 3 ? 'delivered' : 'in_progress',
        dueAt: daysAgo(20 + i),
      })
      .onConflictDoUpdate({
        target: schema.studyDeliverables.id,
        set: { status: i < 3 ? 'delivered' : 'in_progress' },
      })

  // Stable IDs are used here because these rows have no caller-ID RPC and are
  // safely convergent; run telemetry is likewise keyed by source ID.
  await db
    .insert(schema.instruments)
    .values({
      id: uuid(0xb00),
      workspaceId: WORKSPACE,
      name: 'BD FACSAria III',
      instrumentType: 'other',
      model: 'FACSAria III',
      serialNumber: 'MONTH-FACS-001',
      vendor: 'BD Biosciences',
      createdByUserId: GARETH,
      updatedByUserId: GARETH,
    })
    .onConflictDoUpdate({
      target: schema.instruments.id,
      set: { name: 'BD FACSAria III' },
    })
  for (let i = 0; i < 15; i++) {
    const status =
      i < 10 ? 'completed' : i < 12 ? 'running' : i === 12 ? 'failed' : 'queued'
    await db
      .insert(schema.instrumentRuns)
      .values({
        id: uuid(0xb20 + i),
        workspaceId: WORKSPACE,
        instrumentId: uuid(0xb00),
        projectId: uuid(0x200 + (i % 3)),
        name: `Flow cytometry run ${String(i + 1).padStart(2, '0')}`,
        runIdentifier: `RUN-2026-${String(i + 1).padStart(4, '0')}`,
        protocolName: 'CAR phenotype panel',
        plateFormat: '96',
        operator: people[i % 5][0],
        status,
        progressPercent:
          status === 'completed' ? 100 : status === 'running' ? 55 : 0,
        startedAt: status === 'queued' ? null : daysAgo(i * 2),
        completedAt:
          status === 'completed' || status === 'failed'
            ? daysAgo(i * 2, 14)
            : null,
        createdByUserId: GARETH,
        updatedByUserId: GARETH,
      })
      .onConflictDoUpdate({
        target: [
          schema.instrumentRuns.workspaceId,
          schema.instrumentRuns.runIdentifier,
        ],
        set: {
          status,
          progressPercent:
            status === 'completed' ? 100 : status === 'running' ? 55 : 0,
        },
      })
    if (i < 10) {
      await db
        .insert(schema.instrumentObservations)
        .values({
          id: uuid(0xc00 + i),
          workspaceId: WORKSPACE,
          runId: uuid(0xb20 + i),
          sourceId: `month-run-${i + 1}-complete`,
          observationType: 'run_complete',
          sourceTimestamp: daysAgo(i * 2, 14),
          payload: { events: 50000, medianFluorescence: 2450 + i * 40 },
        })
        .onConflictDoNothing({ target: schema.instrumentObservations.id })
      await db
        .insert(schema.instrumentPlateSnapshots)
        .values({
          id: uuid(0xc20 + i),
          workspaceId: WORKSPACE,
          runId: uuid(0xb20 + i),
          plateFormat: '96',
          wells: { A1: { value: 92 + i }, A2: { value: 90 + i } },
          capturedAt: daysAgo(i * 2, 13),
          cycleNumber: 1,
        })
        .onConflictDoNothing({ target: schema.instrumentPlateSnapshots.id })
      await db
        .insert(schema.instrumentQcChecks)
        .values({
          id: uuid(0xc40 + i),
          workspaceId: WORKSPACE,
          runId: uuid(0xb20 + i),
          checkName: 'Event count and controls',
          checkType: i === 7 ? 'warning' : 'pass',
          message: 'Controls within acceptance criteria',
          detail: { threshold: 10000 },
        })
        .onConflictDoNothing({ target: schema.instrumentQcChecks.id })
      await db
        .insert(schema.instrumentRawFiles)
        .values({
          id: uuid(0xc60 + i),
          workspaceId: WORKSPACE,
          runId: uuid(0xb20 + i),
          filename: `flow-run-${i + 1}.fcs`,
          mediaType: 'application/octet-stream',
          sizeBytes: BigInt(102400 + i),
          storageKey: `month-seed/raw/flow-run-${i + 1}.fcs`,
          ingestionStatus: 'complete',
        })
        .onConflictDoNothing({ target: schema.instrumentRawFiles.id })
    }
  }
}

async function upsertReviewsAndReports(db: Parameters<SeedStep['run']>[0]) {
  const auth = await authClient(db)
  try {
    // --- Reports (RPC-created, lookup-or-create by document_identifier) ---
    const reportDefs = [
      [
        'Cell Therapy Process Development Summary',
        'Monthly progress report for the CAR-T program',
        0,
      ],
      [
        'Stability Study Report — July 2026',
        'ICH-compliant stability data compilation',
        2,
      ],
      [
        'Quality Control Trend Analysis',
        'Cross-project QC metrics and exceptions',
        2,
      ],
    ] as const
    for (const [i, [title, subtitle, projIdx]] of reportDefs.entries()) {
      const docId = `RPT-2026-${String(i + 1).padStart(4, '0')}`
      const found = await auth.client.query(
        'select id from api.report_definitions where workspace_id=$1 and document_identifier=$2',
        [WORKSPACE, docId],
      )
      let reportId: string
      if (found.rowCount) {
        reportId = found.rows[0].id as string
      } else {
        const res = await auth.rpc('create_report_definition', [
          WORKSPACE,
          title,
          subtitle,
          uuid(0x200 + projIdx),
        ])
        reportId = res.rows[0].id as string
        // Update document_identifier to our stable value
        await auth.client.query(
          'update api.report_definitions set document_identifier=$1 where id=$2',
          [docId, reportId],
        )
      }

      // Add sections if they don't exist yet
      const existingSections = await auth.client.query(
        'select count(*)::int as n from api.report_sections where report_id=$1',
        [reportId],
      )
      if (existingSections.rows[0].n === 0) {
        const sectionDefs = [
          ['Executive Summary', 'text', 'free_text'],
          ['Methods and Materials', 'text', 'free_text'],
          ['Key Results', 'text', 'free_text'],
          ['Discussion and Conclusions', 'text', 'free_text'],
          ['Appendix — Raw Data References', 'text', 'free_text'],
        ] as const
        for (const [, [secTitle, secType, srcType]] of sectionDefs.entries()) {
          await auth.rpc('add_report_section', [
            WORKSPACE,
            reportId,
            secTitle,
            `Section content for ${secTitle}`,
            secType,
            srcType,
          ])
        }
      }
    }

    // --- Revisions for 8 completed experiments ---
    // Create simple revisions that capture the experiment state for review
    const experimentIds = Array.from({ length: 8 }, (_, i) => uuid(0x300 + i))
    for (let i = 0; i < 8; i++) {
      const recordId = experimentIds[i]
      const revId = uuid(0x400 + i)
      const existing = await db
        .select({ id: schema.revisions.id })
        .from(schema.revisions)
        .where(eq(schema.revisions.id, revId))
        .limit(1)
      if (existing.length === 0) {
        const snapshot = {
          record: {
            id: recordId,
            identifier: `EXP-2026-${String(i + 1).padStart(4, '0')}`,
            title: experimentTitles[i],
            status: 'completed',
          },
          blocks: [],
          files: [],
        }
        const digest = createHash('sha256')
          .update(JSON.stringify(snapshot))
          .digest('hex')
        await db
          .insert(schema.revisions)
          .values({
            id: revId,
            workspaceId: WORKSPACE,
            recordId,
            structureVersion: 1,
            metadataVersion: 1,
            metadataSnapshot: {
              title: experimentTitles[i],
              status: 'completed',
            },
            blockSnapshot: [],
            canonicalSnapshot: snapshot,
            reason: 'submit',
            createdByUserId: GARETH,
            integrityAlgorithm: 'sha256',
            integrityDigest: digest,
          })
          .onConflictDoNothing({ target: schema.revisions.id })
      }
    }

    // --- Review submissions (8 submissions with various states) ---
    const reviewerIds = people.map((_, i) => uuid(0x201 + i))
    for (let i = 0; i < 8; i++) {
      const subId = uuid(0x420 + i)
      const revId = uuid(0x400 + i)
      const recordId = experimentIds[i]
      // 5 approved, 2 returned (changes requested), 1 submitted (pending)
      const state = i < 5 ? 'approved' : i < 7 ? 'returned' : 'submitted'
      const existing = await db
        .select({ id: schema.reviewSubmissions.id })
        .from(schema.reviewSubmissions)
        .where(eq(schema.reviewSubmissions.id, subId))
        .limit(1)
      if (existing.length === 0) {
        await db
          .insert(schema.reviewSubmissions)
          .values({
            id: subId,
            workspaceId: WORKSPACE,
            recordId,
            revisionId: revId,
            state,
            workflowDefinitionKey: 'default-scientific-review',
            workflowDefinitionVersion: 1,
            // Assign the pending review (i=7) to Gareth so it appears on his dashboard.
            // Returned reviews (i=5,6) stay with Anna.
            assignedReviewerUserIds: i === 7 ? [GARETH] : [reviewerIds[4]], // Anna Kowalski reviews
            submittedByUserId: GARETH,
            submittedSessionId: 'month-seed',
            submittedRole: 'owner',
            submittedAt: daysAgo(i * 3 + 1),
            idempotencyKey: `month-review-${i + 1}`,
          })
          .onConflictDoNothing({ target: schema.reviewSubmissions.id })
      }

      // Review decisions for approved and changes_requested
      if (i < 7) {
        const decId = uuid(0x440 + i)
        const decision = i < 5 ? 'approve' : 'request_changes'
        const existingDec = await db
          .select({ id: schema.reviewDecisions.id })
          .from(schema.reviewDecisions)
          .where(eq(schema.reviewDecisions.id, decId))
          .limit(1)
        if (existingDec.length === 0) {
          const rev = await db
            .select({ integrityDigest: schema.revisions.integrityDigest })
            .from(schema.revisions)
            .where(eq(schema.revisions.id, revId))
            .limit(1)
          await db
            .insert(schema.reviewDecisions)
            .values({
              id: decId,
              workspaceId: WORKSPACE,
              submissionId: subId,
              revisionId: revId,
              recordId,
              decision,
              note:
                i < 5
                  ? 'Results meet acceptance criteria. Approved for release.'
                  : 'Please clarify the statistical method used for the replicate analysis.',
              revisionIntegrityDigest: rev[0]?.integrityDigest ?? 'seed-digest',
              actorUserId: reviewerIds[4],
              actorSessionId: 'month-seed',
              actorRole: 'reviewer',
            })
            .onConflictDoNothing({ target: schema.reviewDecisions.id })
        }
      }

      // Signatures for approved reviews
      if (i < 5) {
        const sigId = uuid(0x460 + i)
        const existingSig = await db
          .select({ id: schema.signatures.id })
          .from(schema.signatures)
          .where(eq(schema.signatures.id, sigId))
          .limit(1)
        if (existingSig.length === 0) {
          const rev = await db
            .select({ integrityDigest: schema.revisions.integrityDigest })
            .from(schema.revisions)
            .where(eq(schema.revisions.id, revId))
            .limit(1)
          await db
            .insert(schema.signatures)
            .values({
              id: sigId,
              workspaceId: WORKSPACE,
              submissionId: subId,
              revisionId: revId,
              recordId,
              signatureMeaning: 'approve-for-record',
              assuranceLevel: 'standard',
              revisionIntegrityDigest: rev[0]?.integrityDigest ?? 'seed-digest',
              signerUserId: reviewerIds[4],
              signerSessionId: 'month-seed',
              signerRole: 'reviewer',
              authMethod: 'session+name-confirmation',
              confirmationPhrase: 'I approve this revision for release',
              signedAt: daysAgo(i * 3),
            })
            .onConflictDoNothing({ target: schema.signatures.id })
        }
      }
    }

    // --- Two additional pending reviews assigned to Gareth ---
    // These ensure the dashboard's "My priorities" and "Upcoming approvals"
    // sections have meaningful content for the signed-in user.
    for (let i = 8; i < 10; i++) {
      const recordId = experimentIds[i] ?? uuid(0x300 + i)
      const revId = uuid(0x408 + (i - 8))
      const subId = uuid(0x428 + (i - 8))
      // Create revision if missing
      const existingRev = await db
        .select({ id: schema.revisions.id })
        .from(schema.revisions)
        .where(eq(schema.revisions.id, revId))
        .limit(1)
      if (existingRev.length === 0) {
        const snapshot = {
          record: {
            id: recordId,
            identifier: `EXP-2026-${String(i + 1).padStart(4, '0')}`,
            title: experimentTitles[i],
            status: 'completed',
          },
          blocks: [],
          files: [],
        }
        const digest = createHash('sha256')
          .update(JSON.stringify(snapshot))
          .digest('hex')
        await db
          .insert(schema.revisions)
          .values({
            id: revId,
            workspaceId: WORKSPACE,
            recordId,
            structureVersion: 1,
            metadataVersion: 1,
            metadataSnapshot: {
              title: experimentTitles[i],
              status: 'completed',
            },
            blockSnapshot: [],
            canonicalSnapshot: snapshot,
            reason: 'submit',
            createdByUserId: GARETH,
            integrityAlgorithm: 'sha256',
            integrityDigest: digest,
          })
          .onConflictDoNothing({ target: schema.revisions.id })
      }
      const existingSub = await db
        .select({ id: schema.reviewSubmissions.id })
        .from(schema.reviewSubmissions)
        .where(eq(schema.reviewSubmissions.id, subId))
        .limit(1)
      if (existingSub.length === 0) {
        await db
          .insert(schema.reviewSubmissions)
          .values({
            id: subId,
            workspaceId: WORKSPACE,
            recordId,
            revisionId: revId,
            state: 'submitted',
            workflowDefinitionKey: 'default-scientific-review',
            workflowDefinitionVersion: 1,
            assignedReviewerUserIds: [GARETH],
            submittedByUserId: GARETH,
            submittedSessionId: 'month-seed',
            submittedRole: 'owner',
            submittedAt: daysAgo((i - 8) * 2 + 5),
            idempotencyKey: `month-review-gareth-${i - 8 + 1}`,
          })
          .onConflictDoNothing({ target: schema.reviewSubmissions.id })
      }
    }

    // --- Comments on revisions ---
    const commentBodies = [
      'Can you add the raw fluorescence data to the appendix?',
      'The acceptance criteria for this assay should be referenced explicitly.',
      'Looks good — the trend is consistent with previous batches.',
      'Please verify the calculation for sample dilution factor.',
      'The CV between replicates is slightly above our usual threshold. Any explanation?',
      'Approved. Well-documented experiment.',
      'Consider adding a negative control for the next run.',
      'The pH drift in run 3 is notable — worth investigating.',
      'Good catch on the pipetting error. Documented correctly.',
      'This aligns with the stability protocol. Proceeding to the next timepoint.',
    ]
    for (let i = 0; i < 10; i++) {
      const commentId = uuid(0x480 + i)
      const revId = uuid(0x400 + (i % 8))
      const recordId = experimentIds[i % 8]
      const existing = await db
        .select({ id: schema.comments.id })
        .from(schema.comments)
        .where(eq(schema.comments.id, commentId))
        .limit(1)
      if (existing.length === 0) {
        await db
          .insert(schema.comments)
          .values({
            id: commentId,
            workspaceId: WORKSPACE,
            revisionId: revId,
            recordId,
            rootId: commentId,
            parentId: null,
            targetKind: 'block',
            target: { blockId: uuid(0x500 + (i % 30) * 8) },
            body: commentBodies[i],
            mentions: i >= 7 ? [GARETH] : i % 3 === 0 ? [GARETH] : [],
            state: i < 7 ? 'resolved' : 'open',
            resolvedAt: i < 7 ? daysAgo(i) : null,
            resolvedByUserId: i < 7 ? reviewerIds[4] : null,
            authorUserId: uuid(0x201 + (i % 5)),
          })
          .onConflictDoNothing({ target: schema.comments.id })
      }
    }

    // --- Reply comments (threaded) ---
    const replies = [
      'Good point — will add in the next revision.',
      'Agreed, the reference is in section 2.1 of the protocol.',
      'Thanks for the review. Updated accordingly.',
    ]
    for (let i = 0; i < 3; i++) {
      const replyId = uuid(0x4a0 + i)
      const parentId = uuid(0x480 + i)
      const revId = uuid(0x400 + (i % 8))
      const recordId = experimentIds[i % 8]
      const existing = await db
        .select({ id: schema.comments.id })
        .from(schema.comments)
        .where(eq(schema.comments.id, replyId))
        .limit(1)
      if (existing.length === 0) {
        await db
          .insert(schema.comments)
          .values({
            id: replyId,
            workspaceId: WORKSPACE,
            revisionId: revId,
            recordId,
            rootId: parentId,
            parentId,
            targetKind: 'block',
            target: { blockId: uuid(0x500 + (i % 30) * 8) },
            body: replies[i],
            mentions: [],
            state: 'resolved',
            resolvedAt: daysAgo(i),
            resolvedByUserId: GARETH,
            authorUserId: GARETH,
          })
          .onConflictDoNothing({ target: schema.comments.id })
      }
    }
  } finally {
    await auth.close()
  }
}

// ---------------------------------------------------------------------------
// Showcase notebook — one experiment with every supported block type so the
// dense notebook layout can be evaluated with representative content.
// ---------------------------------------------------------------------------

const SHOWCASE_RECORD = uuid(0x3fe)

function buildPlateMapWells() {
  const wells: Array<Record<string, unknown>> = []
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  const sampleIds = [uuid(0x340), uuid(0x341), uuid(0x342), uuid(0x343)]
  const sampleIdents = [
    'SMP-2026-0001',
    'SMP-2026-0002',
    'SMP-2026-0003',
    'SMP-2026-0004',
  ]
  const sampleTitles = [
    'CAR-T process sample 01',
    'CAR-T process sample 02',
    'CAR-T process sample 03',
    'CAR-T process sample 04',
  ]
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 12; c++) {
      const wellCode = `${rows[r]}${c + 1}`
      let role = 'empty'
      let sampleRef: Record<string, unknown> | undefined
      let replicate: number | undefined
      if (c < 3) {
        role = 'positive_control'
        sampleRef = {
          recordId: sampleIds[0],
          identifier: sampleIdents[0],
          title: sampleTitles[0],
        }
        replicate = c + 1
      } else if (c < 6) {
        role = 'negative_control'
        sampleRef = {
          recordId: sampleIds[1],
          identifier: sampleIdents[1],
          title: sampleTitles[1],
        }
        replicate = c - 2
      } else if (c < 9) {
        role = 'blank'
      } else {
        // Samples in columns 10-12, 4 samples across rows
        const sampleIdx = r % 4
        role = 'sample'
        sampleRef = {
          recordId: sampleIds[sampleIdx],
          identifier: sampleIdents[sampleIdx],
          title: sampleTitles[sampleIdx],
        }
        replicate = c - 8
      }
      const well: Record<string, unknown> = {
        wellCode,
        row: r,
        col: c,
        role,
        volume: { value: 25, unit: 'uL' },
      }
      if (sampleRef) well.sampleRef = sampleRef
      if (replicate !== undefined) well.replicate = replicate
      wells.push(well)
    }
  }
  return wells
}

async function upsertShowcaseNotebook(db: Parameters<SeedStep['run']>[0]) {
  // --- Create the showcase experiment record ---
  const existingRecord = await db
    .select({ id: schema.records.id })
    .from(schema.records)
    .where(eq(schema.records.id, SHOWCASE_RECORD))
    .limit(1)
  if (existingRecord.length === 0) {
    await db
      .insert(schema.records)
      .values({
        id: SHOWCASE_RECORD,
        workspaceId: WORKSPACE,
        projectId: uuid(0x200),
        kind: 'experiment',
        identifier: 'EXP-2026-SHOW',
        title: 'Block Type Showcase — Lentiviral Vector Stability',
        status: 'in_progress',
        tags: ['showcase', 'cell-therapy'],
        properties: { owner: 'Gareth', studyDay: 42 },
        createdAt: daysAgo(10),
        updatedAt: daysAgo(0, 14),
        createdByUserId: GARETH,
        updatedByUserId: GARETH,
      })
      .onConflictDoNothing({ target: schema.records.id })
  }

  // --- Delete existing showcase blocks for idempotency ---
  // Delete old manual change events first to avoid sequence conflicts
  await db
    .delete(schema.changeEvents)
    .where(sql`id::text LIKE '00000000-0000-4000-8000-000000000d0%'`)
  // Sync the workspace change sequence counter to MAX(sequence)
  await db.execute(sql`
    INSERT INTO api.workspace_change_seq (workspace_id, last_seq)
    SELECT ${WORKSPACE}, COALESCE(MAX(sequence), 0)
    FROM api.change_events WHERE workspace_id = ${WORKSPACE}
    ON CONFLICT (workspace_id) DO UPDATE SET last_seq = EXCLUDED.last_seq, updated_at = now()
  `)
  // Unlock the showcase record if it was locked by a previous review
  await db
    .update(schema.records)
    .set({ lockedAt: null, lockedByRevisionId: null })
    .where(eq(schema.records.id, SHOWCASE_RECORD))
  // Clean up orphaned scientific tables BEFORE deleting blocks (FK constraint)
  const orphanedTables = await db
    .select({
      id: schema.scientificTables.id,
      resourceName: schema.scientificTables.resourceName,
    })
    .from(schema.scientificTables)
    .where(eq(schema.scientificTables.recordId, SHOWCASE_RECORD))
  for (const t of orphanedTables) {
    await db.execute(
      sql`DROP TABLE IF EXISTS api.${sql.identifier(t.resourceName)}`,
    )
  }
  await db
    .delete(schema.scientificTables)
    .where(eq(schema.scientificTables.recordId, SHOWCASE_RECORD))
  // Now safe to delete blocks
  await db
    .delete(schema.blocks)
    .where(eq(schema.blocks.recordId, SHOWCASE_RECORD))
  // Clean up record links from previous runs
  await db
    .delete(schema.recordLinks)
    .where(eq(schema.recordLinks.sourceRecordId, SHOWCASE_RECORD))

  const protocolRecordId = uuid(0x360)

  // --- Add procedure_step blocks to the protocol template record ---
  // These will be copied into the experiment by pin_protocol_reference.
  // The DB trigger requires procedure_step blocks in experiments to come from
  // the pin_protocol_reference RPC, not direct inserts.
  const existingProtocolBlocks = await db
    .select({ id: schema.blocks.id })
    .from(schema.blocks)
    .where(eq(schema.blocks.recordId, protocolRecordId))
    .limit(1)
  if (existingProtocolBlocks.length === 0) {
    const protocolSteps = [
      {
        text: 'Thaw the LVV drug substance vials at room temperature for 5 minutes. Mix gently by inversion (do not vortex).',
        stepNumber: 1,
      },
      {
        text: 'Prepare 1:10 dilution series in Dulbecco\u2019s PBS: add 100 \u00b5L of stock to 900 \u00b5L PBS, vortex briefly, repeat for 10\u207b\u00b9 through 10\u207b\u2076.',
        stepNumber: 2,
      },
    ]
    for (const [j, step] of protocolSteps.entries()) {
      await db
        .insert(schema.blocks)
        .values({
          id: uuid(0x610 + j),
          recordId: protocolRecordId,
          type: 'procedure_step',
          payload: step,
          order: j + 1,
          createdByUserId: GARETH,
        })
        .onConflictDoNothing({ target: schema.blocks.id })
    }
  }

  // --- Helper for rich text payloads ---
  const doc = (content: unknown[]) => ({
    doc: { type: 'doc' as const, content },
  })
  const para = (text: string) => ({
    type: 'paragraph' as const,
    content: [{ type: 'text' as const, text }],
  })
  const h = (level: 2 | 3, text: string) => ({
    type: 'heading' as const,
    attrs: { level },
    content: [{ type: 'text' as const, text }],
  })
  const bullet = (...items: string[]) => ({
    type: 'bulletList' as const,
    content: items.map((i) => ({
      type: 'listItem' as const,
      content: [para(i)],
    })),
  })

  // --- Phase 1: Insert blocks before the protocol reference ---
  // These go in first, then we pin the protocol (which copies procedure_step
  // blocks and reorders), then we insert the remaining blocks after.
  const preProtocolBlocks: Array<{
    type: string
    payload: Record<string, unknown>
  }> = [
    // 1. Rich text — Objective
    {
      type: 'rich_text',
      payload: doc([
        h(2, 'Objective'),
        para(
          'Evaluate lentiviral vector stability at 4\u00b0C across an 8-week timecourse. This study supports the comparability assessment for the process change from batch A to batch B.',
        ),
      ]),
    },
    // 2. Rich text — Background with bullet list
    {
      type: 'rich_text',
      payload: doc([
        h(2, 'Background'),
        para(
          'The lentiviral vector (LVV) bulk drug substance must demonstrate stability at the recommended storage temperature. Previous batch A data showed acceptable stability through 8 weeks at 4\u00b0C.',
        ),
        bullet(
          'Batch A historical data: 8-week stability at 4\u00b0C confirmed',
          'Acceptance criterion: \u2264 0.5 log\u2081\u2080 drop in titer from T0',
          'Storage condition: 4\u00b0C \u00b1 2\u00b0C, protected from light',
          'Assay: qPCR-based vector genome copy number (VGCN)',
        ),
      ]),
    },
    // 3. Materials
    {
      type: 'materials',
      payload: {
        items: [
          {
            id: 'mat-show-1',
            materialRecordId: uuid(0x340),
            kind: 'sample',
            identifier: 'SMP-2026-0001',
            title: 'CAR-T process sample 01',
            quantity: 5,
            unit: { code: 'mL', symbol: 'mL', quantityKind: 'volume' },
            observedAt: daysAgo(10).toISOString(),
          },
          {
            id: 'mat-show-2',
            materialRecordId: uuid(0x350),
            kind: 'reagent',
            identifier: 'RGT-2026-0001',
            title: 'Dulbecco\u2019s PBS',
            quantity: 50,
            unit: { code: 'mL', symbol: 'mL', quantityKind: 'volume' },
            observedAt: daysAgo(10).toISOString(),
          },
          {
            id: 'mat-show-3',
            materialRecordId: uuid(0x341),
            kind: 'sample',
            identifier: 'SMP-2026-0002',
            title: 'CAR-T process sample 02',
            quantity: 3,
            unit: { code: 'mL', symbol: 'mL', quantityKind: 'volume' },
            observedAt: daysAgo(8).toISOString(),
          },
        ],
      },
    },
    // 4. Checklist
    {
      type: 'checklist',
      payload: {
        items: [
          {
            text: 'Verify qPCR instrument calibration (QuantStudio 7)',
            checked: true,
          },
          {
            text: 'Prepare 1:10 dilution series of reference standard',
            checked: true,
          },
          { text: 'Run standards and samples in triplicate', checked: true },
          {
            text: 'Record Ct values at each timepoint (T0, T1, T2, T4, T8 weeks)',
            checked: false,
          },
          {
            text: 'Calculate vector genome copy number (VGCN) per mL',
            checked: false,
          },
          { text: 'Compare against batch A historical data', checked: false },
          { text: 'Document any deviations from protocol', checked: false },
        ],
      },
    },
    // 5. Callout
    {
      type: 'callout',
      payload: {
        variant: 'warning',
        text: 'This study follows the comparability protocol approved in revision REV-2026-0042. Any deviation must be documented as an amendment and approved by QA before proceeding.',
      },
    },
    // 6. Protocol reference (draft — pinned via RPC below)
    { type: 'protocol_reference', payload: {} },
  ]

  for (const [j, block] of preProtocolBlocks.entries()) {
    await db
      .insert(schema.blocks)
      .values({
        id: uuid(0x5f0 + j),
        recordId: SHOWCASE_RECORD,
        type: block.type,
        payload: block.payload,
        order: j + 1,
        createdByUserId: GARETH,
      })
      .onConflictDoNothing({ target: schema.blocks.id })
  }

  // --- Phase 2: Pin the protocol reference via RPC ---
  // This populates the protocol_reference block AND copies procedure_step
  // blocks from the protocol template into the experiment.
  const protocolBlockId = uuid(0x5f0 + 5) // block index 5 = protocol_reference
  // Reset structure_version to 1 for idempotency (pin increments it)
  await db
    .update(schema.records)
    .set({ structureVersion: 1 })
    .where(eq(schema.records.id, SHOWCASE_RECORD))
  const auth = await authClient(db)
  try {
    try {
      // Query the current block version (defaults to 1 for new blocks)
      const blockVersionRow = await db
        .select({ version: schema.blocks.version })
        .from(schema.blocks)
        .where(eq(schema.blocks.id, protocolBlockId))
        .limit(1)
      const blockVersion = blockVersionRow[0]?.version ?? 1
      await auth.rpc('pin_protocol_reference', [
        protocolBlockId,
        protocolRecordId,
        blockVersion,
        1,
      ])
    } catch {
      // If pinning fails, the draft block renders "No protocol pinned" — acceptable fallback.
    }

    // --- Phase 3: Insert remaining blocks after the protocol steps ---
    // Use high order values so they come after the pinned procedure_step blocks.
    const postProtocolBlocks: Array<{
      type: string
      payload: Record<string, unknown>
    }> = [
      // Linked record
      {
        type: 'linked_record',
        payload: {
          targetKind: 'experiment',
          targetIdentifier: 'EXP-2026-0001',
          linkType: 'general',
          label: 'Transduction efficiency optimization - Batch 001',
        },
      },
      // Metric
      {
        type: 'metric',
        payload: {
          label: 'Vector titer (T0)',
          value: 2.8e9,
          unit: 'IU/mL',
          provenance: 'qPCR \u2014 QuantStudio 7, triplicate',
        },
      },
      // Table — stability timecourse results
      {
        type: 'table',
        payload: {
          columns: [
            'Timepoint',
            'Batch B Titer (e9 IU/mL)',
            'Batch A Titer (e9 IU/mL)',
            'Log\u2081\u2080 Change',
            'Pass/Fail',
          ],
          rows: [
            ['T0 (Week 0)', '2.80', '2.90', '0.00', 'Pass'],
            ['T1 (Week 1)', '2.70', '2.85', '0.02', 'Pass'],
            ['T2 (Week 2)', '2.65', '2.80', '0.03', 'Pass'],
            ['T4 (Week 4)', '2.50', '2.70', '0.05', 'Pass'],
            ['T8 (Week 8)', '2.30', '2.60', '0.08', 'Pass'],
          ],
        },
      },
      // Plate map — 96-well qPCR layout
      {
        type: 'plate_map',
        payload: {
          title: 'qPCR Plate Layout \u2014 Stability T0',
          spec: {
            specVersion: 1,
            format: '96_well',
            rows: 8,
            cols: 12,
            wells: buildPlateMapWells(),
            validation: {
              requiredRoles: ['positive_control', 'negative_control', 'blank'],
              volumeMin: 10,
              volumeMax: 50,
              volumeUnit: 'uL',
            },
          },
          provenance: 'QuantStudio 7 \u2014 run QS7-2026-0042',
        },
      },
      // File — attached data
      {
        type: 'file',
        payload: {
          fileRecordId: uuid(0x370),
          fileIdentifier: 'FILE-2026-0001',
          displayName: 'assay-results-01.csv',
          mediaType: 'text/csv',
          byteSize: 32,
        },
      },
    ]

    for (const [j, block] of postProtocolBlocks.entries()) {
      await db
        .insert(schema.blocks)
        .values({
          id: uuid(0x5f8 + j),
          recordId: SHOWCASE_RECORD,
          type: block.type,
          payload: block.payload,
          order: 100 + j,
          createdByUserId: GARETH,
        })
        .onConflictDoNothing({ target: schema.blocks.id })
    }

    // --- Phase 4: Create the sheet block + backing scientific table ---
    const sheetBlockId = uuid(0x5ff)
    await db
      .insert(schema.blocks)
      .values({
        id: sheetBlockId,
        recordId: SHOWCASE_RECORD,
        type: 'sheet',
        payload: {},
        order: 200,
        createdByUserId: GARETH,
      })
      .onConflictDoNothing({ target: schema.blocks.id })

    const columnsJson = JSON.stringify([
      {
        label: 'Timepoint (wk)',
        logical_type: 'decimal',
        nullable: false,
        unit: { code: 'wk', symbol: 'wk' },
      },
      {
        label: 'Batch B Titer (e9 IU/mL)',
        logical_type: 'decimal',
        nullable: false,
        unit: { code: 'IU/mL', symbol: 'IU/mL' },
      },
      {
        label: 'Batch A Titer (e9 IU/mL)',
        logical_type: 'decimal',
        nullable: false,
        unit: { code: 'IU/mL', symbol: 'IU/mL' },
      },
      { label: 'Ct Mean', logical_type: 'decimal', nullable: true },
      { label: 'Ct SD', logical_type: 'decimal', nullable: true },
    ])
    const result = await auth.rpc('create_scientific_table', [
      sheetBlockId,
      'Stability Timecourse Data',
      columnsJson,
      'LVV stability qPCR raw data',
    ])
    // RPC returns jsonb — SELECT * wraps it under the function name
    const rpcRow = result.rows[0]
    const rpcData = (rpcRow.create_scientific_table ?? rpcRow) as Record<
      string,
      unknown
    >
    const tableObj = rpcData.table as Record<string, unknown> | undefined
    const tableId = typeof tableObj?.id === 'string' ? tableObj.id : ''
    const resourceName =
      typeof rpcData.resourceName === 'string' ? rpcData.resourceName : ''

    if (tableId) {
      await db
        .update(schema.blocks)
        .set({ payload: { tableId } })
        .where(eq(schema.blocks.id, sheetBlockId))
    }

    if (resourceName) {
      const rowData = [
        {
          timepoint: 0,
          batch_b: 2.8,
          batch_a: 2.9,
          ct_mean: 19.52,
          ct_sd: 0.12,
        },
        {
          timepoint: 1,
          batch_b: 2.7,
          batch_a: 2.85,
          ct_mean: 19.68,
          ct_sd: 0.08,
        },
        {
          timepoint: 2,
          batch_b: 2.65,
          batch_a: 2.8,
          ct_mean: 19.75,
          ct_sd: 0.15,
        },
        {
          timepoint: 4,
          batch_b: 2.5,
          batch_a: 2.7,
          ct_mean: 19.96,
          ct_sd: 0.1,
        },
        {
          timepoint: 8,
          batch_b: 2.3,
          batch_a: 2.6,
          ct_mean: 20.28,
          ct_sd: 0.14,
        },
      ]
      const colResult = await auth.client.query(
        'SELECT field_name FROM api.scientific_columns WHERE table_id = $1 ORDER BY display_order',
        [tableId],
      )
      const fieldNames = colResult.rows.map(
        (r: Record<string, unknown>) => r.field_name as string,
      )
      for (const row of rowData) {
        const mapping: Record<string, unknown> = {
          [fieldNames[0]]: row.timepoint,
          [fieldNames[1]]: row.batch_b,
          [fieldNames[2]]: row.batch_a,
          [fieldNames[3]]: row.ct_mean,
          [fieldNames[4]]: row.ct_sd,
        }
        const values = fieldNames.map((fn: string) => mapping[fn])
        const placeholders = fieldNames.map((_, idx) => `$${idx + 1}`).join(',')
        const colList = fieldNames.join(',')
        // Only insert into scientific columns — workspace_id defaults to
        // api.current_workspace_id() from JWT claims, created_by_user_id is NULL.
        await auth.client.query(
          `INSERT INTO api.${resourceName} (${colList}) VALUES (${placeholders})`,
          [...values],
        )
      }
    }

    // --- Phase 5: Insert the chart block (requires the scientific table from Phase 4) ---
    // The chart DB trigger requires payload.spec to be a valid object with
    // datasets referencing a real active scientific table. We insert it after
    // the sheet table exists, with both a live spec and a frozen snapshot.
    if (tableId) {
      const rawCols = rpcData.columns
      const cols: Array<Record<string, unknown>> = Array.isArray(rawCols)
        ? rawCols
        : []
      const c0Id = String(cols[0]?.id ?? '')
      const c0Name = String(cols[0]?.field_name ?? '')
      const c1Id = String(cols[1]?.id ?? '')
      const c1Name = String(cols[1]?.field_name ?? '')
      const c2Id = String(cols[2]?.id ?? '')
      const c2Name = String(cols[2]?.field_name ?? '')

      if (c0Id && c1Id) {
        await db
          .insert(schema.blocks)
          .values({
            id: uuid(0x5fe),
            recordId: SHOWCASE_RECORD,
            type: 'chart',
            payload: {
              title: 'LVV Stability Trend \u2014 4\u00b0C Storage',
              provenance: 'qPCR VGCN assay, triplicate measurements',
              spec: {
                specVersion: 1,
                type: 'line',
                datasets: [{ tableId }],
                fields: {
                  x: { columnId: c0Id, fieldName: c0Name },
                  y: { columnId: c1Id, fieldName: c1Name },
                  series: null,
                  color: null,
                  size: null,
                },
                filters: [],
                transformations: [],
                display: {
                  axes: {
                    x: { scale: 'linear', label: 'Timepoint (weeks)' },
                    y: { scale: 'linear', label: 'Titer (e9 IU/mL)' },
                  },
                  series: [
                    {
                      identifier: 'batch-b',
                      label: 'Batch B26-106',
                      color: '#006edc',
                    },
                    {
                      identifier: 'batch-a',
                      label: 'Batch A (historical)',
                      color: '#00a659',
                    },
                  ],
                },
                overlays: { errorBars: null },
              },
              frozen: {
                revisionId: null,
                frozenAt: daysAgo(0, 15).toISOString(),
                frozenByUserId: GARETH,
                datasetProvenance: [
                  {
                    tableId,
                    schemaVersion: 1,
                    rowCount: 5,
                    checksum: 'seed-frozen',
                  },
                ],
                data: {
                  columns: [
                    {
                      columnId: c0Id,
                      fieldName: c0Name,
                      label: 'Timepoint (weeks)',
                      logicalType: 'number',
                      unit: { symbol: 'wk' },
                    },
                    {
                      columnId: c1Id,
                      fieldName: c1Name,
                      label: 'Batch B (e9 IU/mL)',
                      logicalType: 'number',
                      unit: { symbol: 'IU/mL' },
                    },
                    {
                      columnId: c2Id,
                      fieldName: c2Name,
                      label: 'Batch A (e9 IU/mL)',
                      logicalType: 'number',
                      unit: { symbol: 'IU/mL' },
                    },
                  ],
                  rows: [],
                  series: [
                    {
                      identifier: 'batch-b',
                      label: 'Batch B26-106',
                      color: '#006edc',
                      points: [
                        { x: 0, y: 2.8 },
                        { x: 1, y: 2.7 },
                        { x: 2, y: 2.65 },
                        { x: 4, y: 2.5 },
                        { x: 8, y: 2.3 },
                      ],
                    },
                    {
                      identifier: 'batch-a',
                      label: 'Batch A (historical)',
                      color: '#00a659',
                      points: [
                        { x: 0, y: 2.9 },
                        { x: 1, y: 2.85 },
                        { x: 2, y: 2.8 },
                        { x: 4, y: 2.7 },
                        { x: 8, y: 2.6 },
                      ],
                    },
                  ],
                },
              },
            },
            order: 150,
            createdByUserId: GARETH,
          })
          .onConflictDoNothing({ target: schema.blocks.id })
      }
    }
  } finally {
    await auth.close()
  }

  // --- Add change events for record/block operations (variety in activity feed) ---
  const activityDefs = [
    [
      'record',
      'create',
      uuid(0x300),
      uuid(0x200),
      {
        title: 'Transduction efficiency optimization - Batch 001',
        identifier: 'EXP-2026-0001',
      },
    ],
    [
      'block',
      'create',
      uuid(0x300),
      uuid(0x200),
      { title: 'Added rich text block: Objective' },
    ],
    [
      'review_submission',
      'create',
      uuid(0x300),
      uuid(0x200),
      { title: 'Submitted for scientific review' },
    ],
    [
      'record',
      'update',
      uuid(0x300),
      uuid(0x200),
      { title: 'Updated experiment status to completed' },
    ],
    [
      'block',
      'update',
      uuid(0x300),
      uuid(0x200),
      { title: 'Updated table block: Results' },
    ],
  ] as const
  const maxSeqResult = await db.execute(
    sql`SELECT COALESCE(MAX(sequence), 0) as max_seq FROM api.change_events WHERE workspace_id = ${WORKSPACE}`,
  )
  const seq = Number(maxSeqResult.rows[0]?.max_seq ?? 0) + 1
  for (let i = 0; i < activityDefs.length; i++) {
    const [entityType, operation, recordId, projectId, payload] =
      activityDefs[i]
    await db
      .insert(schema.changeEvents)
      .values({
        id: uuid(0xd00 + i),
        workspaceId: WORKSPACE,
        sequence: BigInt(seq + i),
        entityType,
        entityUuid: recordId,
        operation,
        recordId,
        projectId,
        actorUserId: GARETH,
        payload,
        createdAt: daysAgo(i, 10 + i),
      })
      .onConflictDoNothing({ target: schema.changeEvents.id })
  }
}

export const monthSteps: Array<SeedStep> = [
  {
    name: 'month: people, projects, records, blocks and files',
    run: upsertCore,
  },
  {
    name: 'month: calendar, planner and instrument operations',
    run: upsertOperations,
  },
  {
    name: 'month: reviews, comments, signatures and reports',
    run: upsertReviewsAndReports,
  },
  {
    name: 'month: showcase notebook (all block types)',
    run: upsertShowcaseNotebook,
  },
]
