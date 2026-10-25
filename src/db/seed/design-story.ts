/**
 * The EXP-0142 story the design shows across Overview, Notebook, Inbox and the
 * project pages: who is on it, what it follows, its protocol steps and the
 * notebook body (materials, method, working sheet, observations, result
 * summary). Everything here is written with plain upserts so reseeding is a
 * no-op once the story exists.
 */
import { and, eq, sql } from 'drizzle-orm'

import * as schema from '../schema'
import type { SeedStep } from './run'

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const MEI = '00000000-0000-4000-8000-000000000312'

const PROTOCOL_REVISION = '00000000-0000-4000-8000-000000000790'
const EXP_0142 = '00000000-0000-4000-8000-000000000351'
const STORY_BLOCK = (n: number) =>
  `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`

type Db = Parameters<SeedStep['run']>[0]

async function recordId(db: Db, identifier: string): Promise<string | null> {
  const rows = await db
    .select({ id: schema.records.id })
    .from(schema.records)
    .where(
      and(
        eq(schema.records.workspaceId, PROCESS),
        eq(schema.records.identifier, identifier),
      ),
    )
    .limit(1)
  return rows[0]?.id ?? null
}

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function heading(text: string) {
  return {
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text }],
  }
}

const PROTOCOL_STEPS = [
  {
    text: 'Hold harvest at 2–8 °C',
    completedAt: '2026-09-21T13:10:00Z',
    note: 'SMP-2231',
  },
  {
    text: 'Filter runs, trains A–C at 50, 100, 150 L/m²',
    completedAt: '2026-09-23T16:40:00Z',
    note: '9 filtrate samples · DS-0310',
  },
  {
    text: 'Filtrate turbidity',
    completedAt: '2026-09-24T15:04:00Z',
    note: 'DS-0311 · 1 value out of range',
  },
  {
    text: 'Capsid titre by ELISA, plates 1–4',
    completedAt: null,
    note: 'In progress: plate 4 today, 11:30 · DS-0311',
  },
  {
    text: 'Step yield by load',
    completedAt: null,
    note: 'Draft · AN-0057',
  },
  {
    text: 'Decision and review',
    completedAt: null,
    note: 'Reviewer Mei L.',
  },
] as const

/**
 * The story is history the design already shows, so writing it must not also
 * emit fresh "created block" events stamped with today's real clock.
 */
export async function seedDesignExperimentStory(db: Db): Promise<void> {
  await db.execute(
    sql`alter table api.blocks disable trigger change_event_blocks`,
  )
  try {
    await writeStory(db)
  } finally {
    await db.execute(
      sql`alter table api.blocks enable trigger change_event_blocks`,
    )
  }
}

/** The filtrate samples the experiment made and used: the design lists all
 * twelve on its Samples tab. Linking is idempotent, so it runs on every seed. */
async function linkStorySamples(db: Db): Promise<void> {
  const identifiers = [
    'SMP-2231',
    ...Array.from({ length: 11 }, (_, i) => `SMP-${2240 + i}`),
  ]
  // They were made on the dates the design shows, not on the day of seeding.
  const made: Record<string, string> = {
    'SMP-2231': '2026-09-20T16:30:00Z',
    'SMP-2249': '2026-09-25T09:34:00Z',
    'SMP-2250': '2026-09-21T10:02:00Z',
  }
  for (const identifier of identifiers) {
    const targetId = await recordId(db, identifier)
    if (!targetId) continue
    await db.execute(sql`
      update api.records
         set created_at = ${made[identifier] ?? '2026-09-23T09:15:00Z'}
       where id = ${targetId}`)
    const existing = await db.execute(sql`
      select 1 from api.record_links
       where source_record_id = ${EXP_0142} and target_record_id = ${targetId}
         and link_type = 'sample' limit 1`)
    if (existing.rows.length) continue
    await db.execute(sql`
      insert into api.record_links
        (source_record_id, target_record_id, target_kind, target_identifier,
         link_type, created_by_user_id)
      values (${EXP_0142}, ${targetId}, 'sample', ${identifier}, 'sample',
              ${GARETH})`)
  }
}

/** The instrument exports and the datasheet the experiment holds. */
async function linkStoryFiles(db: Db): Promise<void> {
  for (const identifier of ['FILE-0002', 'FILE-0003', 'FILE-0004']) {
    const targetId = await recordId(db, identifier)
    if (!targetId) continue
    const existing = await db.execute(sql`
      select 1 from api.record_links
       where source_record_id = ${EXP_0142} and target_record_id = ${targetId}
         and link_type = 'file' limit 1`)
    if (existing.rows.length) continue
    await db.execute(sql`
      insert into api.record_links
        (source_record_id, target_record_id, target_kind, target_identifier,
         link_type, created_by_user_id)
      values (${EXP_0142}, ${targetId}, 'file', ${identifier}, 'file', ${GARETH})`)
  }
}

async function writeStory(db: Db): Promise<void> {
  await linkStorySamples(db)
  await linkStoryFiles(db)
  const exists = await db
    .select({ id: schema.blocks.id })
    .from(schema.blocks)
    .where(eq(schema.blocks.id, STORY_BLOCK(1)))
    .limit(1)
  if (exists.length) return

  // Who and when: the overview inspector reads the reviewer and planned end
  // from the record's own columns.
  await db.execute(sql`
    update api.records
       set reviewer_user_id = ${MEI},
           planned_end = ${'2026-09-29'},
           created_at = ${'2026-09-21T13:10:00Z'}
     where id = ${EXP_0142}`)

  // What it follows and what follows it.
  const protocolId = await recordId(db, 'PRT-021')
  const upstream = [
    ['EXP-0138', 'upstream'],
    ['EXP-0133', 'upstream'],
  ] as const
  if (protocolId) {
    await db.execute(sql`
      insert into api.record_links
        (source_record_id, target_record_id, target_kind, target_identifier,
         link_type, created_by_user_id)
      values (${EXP_0142}, ${protocolId}, 'protocol_template', 'PRT-021', 'protocol',
              ${GARETH})
      on conflict do nothing`)
  }
  for (const [identifier, linkType] of upstream) {
    const targetId = await recordId(db, identifier)
    if (!targetId) continue
    await db.execute(sql`
      insert into api.record_links
        (source_record_id, target_record_id, target_kind, target_identifier,
         link_type, created_by_user_id)
      values (${EXP_0142}, ${targetId}, 'experiment', ${identifier},
              ${linkType}, ${GARETH})
      on conflict do nothing`)
  }
  const nextId = await recordId(db, 'EXP-0145')
  if (nextId) {
    await db.execute(sql`
      insert into api.record_links
        (source_record_id, target_record_id, target_kind, target_identifier,
         link_type, created_by_user_id)
      values (${nextId}, ${EXP_0142}, 'experiment', 'EXP-0142', 'upstream',
              ${GARETH})
      on conflict do nothing`)
  }

  // Notebook body. Objective stays as seeded; Observations moves behind the
  // working sheet.
  await db.execute(sql`
    update api.blocks set "order" = 20
     where record_id = ${EXP_0142}
       and id = ${'00000000-0000-4000-8000-000000000362'}`)

  const materials = await Promise.all(
    [
      ['SMP-2231', 'sample', 'Harvest lot HL-0934', 15, 'L'],
      ['MAT-0418', 'material', 'Filter train A, two-stage depth', 0.023, 'm²'],
      ['MAT-0419', 'material', 'Filter train B, two-stage depth', 0.023, 'm²'],
      [
        'MAT-0420',
        'material',
        'Filter train C, single-stage depth',
        0.023,
        'm²',
      ],
    ].map(async ([identifier, kind, title, quantity, unit]) => ({
      id: `story-${identifier}`,
      materialRecordId: await recordId(db, String(identifier)),
      kind,
      identifier,
      title,
      quantity,
      unit: { code: unit, symbol: unit, quantityKind: 'other' },
      observedAt: '2026-09-21T13:10:00Z',
    })),
  )

  const sheet = await db
    .select({ id: schema.sheetInstances.id })
    .from(schema.sheetInstances)
    .where(
      and(
        eq(schema.sheetInstances.workspaceId, PROCESS),
        eq(schema.sheetInstances.name, 'Clarification working sheet'),
      ),
    )
    .limit(1)

  const blocks: Array<{
    n: number
    type: string
    order: number
    payload: Record<string, unknown>
  }> = [
    {
      n: 1,
      type: 'materials',
      order: 5,
      payload: {
        items: materials.filter((item) => item.materialRecordId !== null),
      },
    },
    {
      n: 2,
      type: 'rich_text',
      order: 6,
      payload: {
        doc: {
          type: 'doc',
          content: [
            heading('Method'),
            paragraph(
              'Harvest was held at 2–8 °C and filtered at a constant flux of 100 LMH. Filtrate was sampled at 50, 100 and 150 L/m² for turbidity and capsid titre (ELISA, method EM-004). Feed titre 8.6 × 10¹¹ cp/mL.',
            ),
          ],
        },
      },
    },
    ...(sheet[0]
      ? [
          {
            n: 4,
            type: 'sheet',
            order: 10,
            payload: { instanceId: sheet[0].id },
          },
        ]
      : []),
    {
      n: 3,
      type: 'rich_text',
      order: 30,
      payload: {
        doc: {
          type: 'doc',
          content: [
            heading('Result summary'),
            paragraph(
              'Selected train B (MAT-0419). Max load 150 L/m². Step yield, train B 84.9–90.7 %. Filtrate turbidity, train B 4.1–8.9 NTU. Decision pending review.',
            ),
          ],
        },
      },
    },
    ...(protocolId ? PROTOCOL_STEPS : []).map((step, index) => ({
      n: 10 + index,
      type: 'procedure_step',
      order: 40 + index,
      payload: {
        text: step.text,
        stepNumber: index + 1,
        sourceProtocolRevisionId: PROTOCOL_REVISION,
        sourceStepBlockId: STORY_BLOCK(30 + index),
        completed: step.completedAt !== null,
        note: step.note,
        completedAt: step.completedAt,
        completedByUserId: step.completedAt ? GARETH : null,
      },
    })),
  ]

  // The experiment's steps are copies of the protocol's reusable procedure, so
  // the protocol carries the same steps and an immutable revision of them.
  if (protocolId) {
    const definitions = PROTOCOL_STEPS.map((step, index) => ({
      id: STORY_BLOCK(30 + index),
      order: index + 1,
      payload: { text: step.text, stepNumber: index + 1 },
    }))
    for (const step of definitions) {
      await db
        .insert(schema.blocks)
        .values({
          ...step,
          recordId: protocolId,
          type: 'procedure_step',
          createdByUserId: GARETH,
        })
        .onConflictDoNothing()
    }
    await db
      .insert(schema.revisions)
      .values({
        id: PROTOCOL_REVISION,
        recordId: protocolId,
        structureVersion: 1,
        metadataVersion: 1,
        reason: 'manual',
        createdByUserId: GARETH,
        createdAt: new Date('2026-09-01T09:00:00Z'),
        updatedAt: new Date('2026-09-01T09:00:00Z'),
        metadataSnapshot: {
          identifier: 'PRT-021',
          title: 'Harvest clarification: depth filter screening',
          status: 'active',
          properties: {},
        },
        blockSnapshot: definitions.map((step) => ({
          id: step.id,
          type: 'procedure_step',
          payload: step.payload,
          order: step.order,
        })),
      })
      .onConflictDoNothing({ target: schema.revisions.id })
  }

  // Execution steps take their actor from the request claims, so write the
  // body in one transaction that carries the author's claims.
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: GARETH, workspace_id: PROCESS })}, true)`,
    )
    for (const block of blocks) {
      await tx
        .insert(schema.blocks)
        .values({
          id: STORY_BLOCK(block.n),
          recordId: EXP_0142,
          type: block.type,
          order: block.order,
          payload: block.payload,
          createdByUserId: GARETH,
        })
        .onConflictDoNothing()
    }
  })

  // Completing a step stamps the real clock; pin each to the date the design
  // shows. The validation trigger would restamp it, so step it aside briefly.
  await db.execute(
    sql`alter table api.blocks disable trigger validate_scientific_block`,
  )
  try {
    for (const [index, step] of PROTOCOL_STEPS.entries()) {
      if (!step.completedAt) continue
      await db.execute(sql`
        update api.blocks
           set payload = jsonb_set(payload, '{completedAt}', to_jsonb(${step.completedAt}::text))
         where id = ${STORY_BLOCK(10 + index)}`)
    }
  } finally {
    await db.execute(
      sql`alter table api.blocks enable trigger validate_scientific_block`,
    )
  }
}
