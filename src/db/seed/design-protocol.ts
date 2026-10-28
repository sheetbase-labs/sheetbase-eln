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

interface ApprovedVersion {
  summary: string
  at: string
  technical: string
  qa: string
}

/**
 * Walks a frozen version through two approvals, review and "effective", and
 * stamps its dates from `spec.at`, so an approved protocol always has the
 * approval record the Approvals panel reads.
 */
async function approveAndMakeEffective(
  db: Db,
  versionId: string,
  spec: ApprovedVersion,
) {
  const at = new Date(spec.at)
  const reviewAt = new Date(at.getTime() + 2 * 86_400_000)
  const qaAt = new Date(at.getTime() + 4 * 86_400_000)
  const effectiveAt = new Date(at.getTime() + 5 * 86_400_000)
  const [request] = await db
    .insert(schema.approvalRequests)
    .values({
      workspaceId: PROCESS,
      objectKind: 'protocol_revision',
      objectId: versionId,
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
      versionId,
      'in_review',
      spec.summary,
    ])
    await client.query('select api.set_protocol_version_status($1,$2,$3,$4)', [
      versionId,
      'effective',
      spec.summary,
      effectiveAt.toISOString(),
    ])
  })
  await db.execute(
    sql`update api.protocol_versions
           set created_at = ${at.toISOString()}::timestamptz,
               updated_at = ${qaAt.toISOString()}::timestamptz,
               review_due_at = ${new Date(
                 qaAt.getTime() + 365 * 86_400_000,
               ).toISOString()}::timestamptz
         where id = ${versionId}`,
  )
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
    await approveAndMakeEffective(db, created.id, spec)
  }
}

interface ActiveProtocol {
  identifier: string
  purpose: string
  procedure: string
  acceptance: string
  at: string
  technical: string
  qa: string
}

/**
 * The other active protocols the lists show. Each gets one short controlled
 * document, frozen as v1 and approved by two people, so "Active" always means
 * a version is effective and approved; the protocols' own pages read the same.
 */
const ACTIVE_PROTOCOLS: ActiveProtocol[] = [
  {
    identifier: 'PRT-006',
    purpose:
      'Transfect HEK293 cells with the PEI:DNA complex and record viability and titre at 72 h.',
    procedure:
      'Seed 3 × 10⁵ cells/mL, add the complex at a 1:3 ratio, then sample daily for viability.',
    acceptance:
      'Viability ≥ 90 % and titre within 20 % of the reference batch.',
    at: '2026-03-10T10:00:00+01:00',
    technical: MEI,
    qa: ANNA,
  },
  {
    identifier: 'PRT-009',
    purpose:
      'Characterise a HEK293 working cell bank by viability, density and identity before release for production.',
    procedure:
      'Thaw one vial, count on the automated counter in triplicate and record viability at 24 h and 48 h.',
    acceptance: 'Viability ≥ 90 % at 24 h and a doubling time under 26 h.',
    at: '2026-02-18T10:00:00+00:00',
    technical: MEI,
    qa: ANNA,
  },
  {
    identifier: 'PRT-012',
    purpose:
      'Measure the full to empty capsid ratio of an AAV preparation by analytical ultracentrifugation.',
    procedure:
      'Load 400 µL at an A260 of 0.5, run at 20 000 rpm and fit the sedimentation coefficient distribution.',
    acceptance: 'Full capsids reported within 2 % of the reference lot.',
    at: '2026-04-02T10:00:00+01:00',
    technical: MEI,
    qa: ANNA,
  },
  {
    identifier: 'PRT-014',
    purpose:
      'Clarify AAV9 harvest with a depth filter and record step yield and filtrate turbidity.',
    procedure:
      'Prime the train with buffer, load harvest at constant flux and log pressure every 10 L/m².',
    acceptance: 'Step yield ≥ 80 % and turbidity ≤ 20 NTU.',
    at: '2026-05-06T10:00:00+01:00',
    technical: MEI,
    qa: ANNA,
  },
  {
    identifier: 'PRT-017',
    purpose:
      'Set the seeding density at transfection and confirm it against the culture record.',
    procedure:
      'Count the culture, dilute to the target density and record the volume and counter reading.',
    acceptance: 'Seeded density within 5 % of the target.',
    at: '2026-05-20T10:00:00+01:00',
    technical: MEI,
    qa: ANNA,
  },
  {
    identifier: 'PRT-019',
    purpose:
      'Pull a day 7 stability sample from each storage condition and send it for the release panel.',
    procedure:
      'Withdraw 1 mL aseptically, split into three aliquots and log the storage position.',
    acceptance: 'Three labelled aliquots per condition, logged the same day.',
    at: '2026-06-02T10:00:00+01:00',
    technical: MEI,
    qa: ANNA,
  },
  {
    identifier: 'PRT-020',
    purpose:
      'Screen expansion media for cell growth and viability over a five day culture.',
    procedure:
      'Seed each medium in triplicate at 5 × 10⁵ cells/mL and count daily.',
    acceptance:
      'Fold expansion reported with a coefficient of variation under 15 %.',
    at: '2026-06-23T10:00:00+01:00',
    technical: MEI,
    qa: ANNA,
  },
  {
    identifier: 'PRT-022',
    purpose:
      'Screen anion exchange resins for AAV capture by binding capacity and full capsid enrichment.',
    procedure:
      'Equilibrate each resin, load at 5 CV/h and elute with a salt gradient, collecting 1 CV fractions.',
    acceptance:
      'Recovery ≥ 70 % with the full capsid fraction reported per resin.',
    at: '2026-07-07T10:00:00+01:00',
    technical: MEI,
    qa: ANNA,
  },
  {
    identifier: 'PRT-024',
    purpose:
      'Route a finished notebook through technical review and quality approval.',
    procedure:
      'Submit the record, assign a reviewer and record each decision against the frozen revision.',
    acceptance: 'Two approvals recorded before the record is signed.',
    at: '2026-07-21T10:00:00+01:00',
    technical: MEI,
    qa: ANNA,
  },
]

/**
 * Gives every active protocol an effective, approved version. PRT-006's v1 is
 * already frozen and in review for the training tab; the rest start with no
 * document at all, so they get a short one first.
 */
async function seedActiveProtocolVersions(db: Db) {
  for (const spec of ACTIVE_PROTOCOLS) {
    const [protocol] = await db
      .select({ id: schema.records.id, status: schema.records.status })
      .from(schema.records)
      .where(
        and(
          eq(schema.records.workspaceId, PROCESS),
          eq(schema.records.identifier, spec.identifier),
          eq(schema.records.kind, 'protocol_template'),
        ),
      )
      .limit(1)
    if (!protocol || protocol.status !== 'active') continue
    const versions = await db
      .select({
        id: schema.protocolVersions.id,
        status: schema.protocolVersions.status,
      })
      .from(schema.protocolVersions)
      .where(eq(schema.protocolVersions.protocolRecordId, protocol.id))
    if (versions.some((v) => v.status === 'effective')) continue

    let versionId = versions.at(0)?.id
    if (!versionId) {
      const blocks = await db
        .select({ id: schema.blocks.id })
        .from(schema.blocks)
        .where(eq(schema.blocks.recordId, protocol.id))
        .limit(1)
      if (!blocks.length) {
        await db.insert(schema.blocks).values({
          recordId: protocol.id,
          type: 'rich_text',
          order: 1,
          payload: doc(
            heading('Purpose'),
            paragraph(spec.purpose),
            heading('Procedure'),
            paragraph(spec.procedure),
            heading('Acceptance criteria'),
            paragraph(spec.acceptance),
          ),
          createdByUserId: GARETH,
        })
      }
      const summary = 'First controlled version.'
      versionId = await withDesignClaims(
        db,
        GARETH,
        PROCESS,
        async (client) =>
          (
            await client.query<{ id: string }>(
              'select * from api.create_protocol_version($1,$2,$3)',
              [protocol.id, summary, summary],
            )
          ).rows[0].id,
      )
    }
    await approveAndMakeEffective(db, versionId, {
      summary: 'First controlled version.',
      at: spec.at,
      technical: spec.technical,
      qa: spec.qa,
    })
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
  await seedActiveProtocolVersions(db)
}
