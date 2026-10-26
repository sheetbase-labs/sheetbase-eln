/**
 * The PRT-021 story the ProtocolDetail board shows: a structured controlled
 * document (purpose, parameters, procedure, acceptance criteria) frozen as
 * three versions, each approved by a technical reviewer and QA, with v3
 * effective and the earlier two superseded. The working blocks hold the v3
 * text; v1 and v2 are frozen from earlier text, so the Versions tab and the
 * "changes from v2" panel read real history.
 */
import { and, eq, sql } from 'drizzle-orm'

import * as schema from '../schema'
import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const MEI = '00000000-0000-4000-8000-000000000312'
const ANNA = '00000000-0000-4000-8000-000000000315'
const PROTOCOL = '00000000-0000-4000-8000-000000000395'

const BLOCK = (n: number) =>
  `00000000-0000-4000-8000-00000000076${n.toString(16)}`

function text(value: string) {
  return { type: 'text', text: value }
}
function heading(value: string) {
  return { type: 'heading', attrs: { level: 2 }, content: [text(value)] }
}
function paragraph(value: string) {
  return { type: 'paragraph', content: [text(value)] }
}
function bullets(items: string[]) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraph(item)],
    })),
  }
}
function doc(...content: unknown[]) {
  return { doc: { type: 'doc', content } }
}

interface VersionSpec {
  version: number
  at: string
  summary: string
  purpose: string
  parameters: string[]
  acceptance: string
  technical: string
  qa: string
}

const VERSIONS: VersionSpec[] = [
  {
    version: 1,
    at: '2026-04-14T10:00:00+01:00',
    summary: 'First controlled version.',
    purpose:
      'Screen depth-filter trains for clarification of AAV harvest and select a train.',
    parameters: [
      'Flux · 80–120 LMH',
      'Load points · 50, 100 L/m²',
      'Harvest hold · 2–8 °C, ≤ 14 days',
    ],
    acceptance: 'Capsid step yield ≥ 80 % at the selected load.',
    technical: MEI,
    qa: ANNA,
  },
  {
    version: 2,
    at: '2026-06-09T10:00:00+01:00',
    summary: 'Pressure logging every 10 L/m² added; hold time limited.',
    purpose:
      'Screen depth-filter trains for clarification of AAV harvest and select a train and maximum load.',
    parameters: [
      'Flux · 80–120 LMH',
      'Load points · 50, 100 L/m²',
      'Harvest hold · 2–8 °C, ≤ 14 days',
      'Pressure logging · every 10 L/m²',
    ],
    acceptance: 'Capsid step yield ≥ 80 % at the selected load.',
    technical: MEI,
    qa: ANNA,
  },
  {
    version: 3,
    at: '2026-08-28T10:00:00+01:00',
    summary:
      'Flux fixed at 100 LMH (was 80–120). Added 150 L/m² load point. Turbidity limit 20 NTU added to criteria.',
    purpose:
      'Screen depth-filter trains for clarification of AAV harvest at constant flux and select a train and maximum load for scale-up.',
    parameters: [
      'Flux · 100 LMH · ± 5',
      'Load points · 50, 100, 150 L/m²',
      'Harvest hold · 2–8 °C · ≤ 14 days',
      'Pressure logging · every 10 L/m²',
    ],
    acceptance:
      'Capsid step yield ≥ 80 % and filtrate turbidity ≤ 20 NTU at the selected load.',
    technical: MEI,
    qa: ANNA,
  },
]

async function writeWorkingDocument(db: Db, spec: VersionSpec) {
  const blocks = [
    {
      id: BLOCK(0),
      order: 1,
      payload: doc(heading('1 · Purpose'), paragraph(spec.purpose)),
    },
    {
      id: BLOCK(1),
      order: 2,
      payload: doc(heading('2 · Parameters'), bullets(spec.parameters)),
    },
    {
      id: BLOCK(2),
      order: 3,
      payload: doc(heading('3 · Procedure')),
    },
    {
      id: BLOCK(3),
      order: 20,
      payload: doc(
        heading('4 · Acceptance criteria'),
        paragraph(spec.acceptance),
      ),
    },
  ]
  for (const block of blocks) {
    await db
      .insert(schema.blocks)
      .values({
        id: block.id,
        recordId: PROTOCOL,
        type: 'rich_text',
        order: block.order,
        payload: block.payload,
        createdByUserId: GARETH,
      })
      .onConflictDoUpdate({
        target: schema.blocks.id,
        set: { payload: block.payload },
      })
  }
}

async function createProtocolVersions(db: Db) {
  const existing = await db
    .select({ id: schema.protocolVersions.id })
    .from(schema.protocolVersions)
    .where(eq(schema.protocolVersions.protocolRecordId, PROTOCOL))
    .limit(1)
  if (existing.length) return

  // The procedure steps keep their ids (the EXP-0142 story pins them) and move
  // behind the purpose and parameters.
  const steps = await db
    .select({ id: schema.blocks.id })
    .from(schema.blocks)
    .where(
      and(
        eq(schema.blocks.recordId, PROTOCOL),
        eq(schema.blocks.type, 'procedure_step'),
      ),
    )
  if (!steps.length) return
  await db.execute(
    sql`update api.blocks set "order" = "order" + 100 where record_id = ${PROTOCOL} and type = 'procedure_step'`,
  )
  await db.execute(
    sql`update api.blocks set "order" = "order" - 100 + 3 where record_id = ${PROTOCOL} and type = 'procedure_step'`,
  )

  for (const spec of VERSIONS) {
    await writeWorkingDocument(db, spec)
    const created = await withDesignClaims(
      db,
      GARETH,
      PROCESS,
      async (client) =>
        (
          await client.query<{ id: string }>(
            'select * from api.create_protocol_version($1,$2,$3)',
            [PROTOCOL, spec.summary, spec.summary],
          )
        ).rows[0],
    )
    const at = new Date(spec.at)
    const reviewAt = new Date(at.getTime() + 2 * 86_400_000)
    const qaAt = new Date(at.getTime() + 4 * 86_400_000)
    const effectiveAt = new Date(at.getTime() + 5 * 86_400_000)
    const [request] = await db
      .insert(schema.approvalRequests)
      .values({
        workspaceId: PROCESS,
        objectKind: 'protocol_revision',
        objectId: created.id,
        objectRevision: null,
        requiredApproverRoles: [
          'admin',
          'owner',
          'reviewer',
          'scientist',
          'steward',
        ],
        requiredApprovals: 2,
        state: 'approved',
        reason: spec.summary,
        approvedByUserIds: [spec.technical, spec.qa],
        submittedByUserId: GARETH,
        submittedAt: at,
        decidedByUserId: spec.qa,
        decidedAt: qaAt,
      })
      .returning({ id: schema.approvalRequests.id })
    await db.insert(schema.approvalRequestDecisions).values([
      {
        requestId: request.id,
        workspaceId: PROCESS,
        userId: spec.technical,
        role: 'scientist',
        decision: 'approved',
        createdAt: reviewAt,
      },
      {
        requestId: request.id,
        workspaceId: PROCESS,
        userId: spec.qa,
        role: 'reviewer',
        decision: 'approved',
        createdAt: qaAt,
      },
    ])
    await withDesignClaims(db, GARETH, PROCESS, async (client) => {
      await client.query('select api.set_protocol_version_status($1,$2,$3)', [
        created.id,
        'in_review',
        spec.summary,
      ])
      await client.query(
        'select api.set_protocol_version_status($1,$2,$3,$4)',
        [created.id, 'effective', spec.summary, effectiveAt.toISOString()],
      )
    })
    await db.execute(
      sql`update api.protocol_versions
             set created_at = ${at.toISOString()}::timestamptz,
                 updated_at = ${qaAt.toISOString()}::timestamptz,
                 review_due_at = ${new Date(
                   qaAt.getTime() + 365 * 86_400_000,
                 ).toISOString()}::timestamptz
           where id = ${created.id}`,
    )
  }
}

export async function seedDesignProtocolStory(db: Db) {
  await createProtocolVersions(db)
  // Who runs which version: EXP-0142 and EXP-0145 on the effective v3, two
  // older experiments on v2. Direct writes: the version is chosen when an
  // experiment starts, and these experiments were started on past dates.
  const versionIds = await db
    .select({
      id: schema.protocolVersions.id,
      version: schema.protocolVersions.version,
    })
    .from(schema.protocolVersions)
    .where(eq(schema.protocolVersions.protocolRecordId, PROTOCOL))
  const idOf = (version: number) =>
    versionIds.find((v) => v.version === version)?.id
  for (const [identifier, version] of [
    ['EXP-0142', 3],
    ['EXP-0145', 3],
    ['EXP-0139', 2],
    ['EXP-0137', 2],
  ] as const) {
    const protocolVersionId = idOf(version)
    if (!protocolVersionId) continue
    await db.execute(
      sql`update api.records set protocol_version_id = ${protocolVersionId}
           where workspace_id = ${PROCESS} and identifier = ${identifier}`,
    )
    await db.execute(
      sql`insert into api.record_links
            (source_record_id, target_record_id, target_kind, target_identifier,
             link_type, created_by_user_id)
          select r.id, ${PROTOCOL}, 'protocol_template', 'PRT-021', 'protocol', ${GARETH}
            from api.records r
           where r.workspace_id = ${PROCESS} and r.identifier = ${identifier}
          on conflict do nothing`,
    )
  }
}
