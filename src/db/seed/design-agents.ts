/**
 * The Agents boards: six workflows with their policy and recent runs, the
 * numbered policy revisions, and the eight proposals the Proposals board lists
 * (three for Gareth, two waiting on colleagues, three decided).
 *
 * The two notebook-block proposals go through the real proposal function, so
 * approving them writes the block. The rest are stored directly with the
 * operation kind the board's action names; they are there to be read.
 * Idempotent: it does nothing once AG-0003 exists.
 */
import { sql } from 'drizzle-orm'

import { withDesignClaims } from './claims'
import type { SeedStep } from './run'

type Db = Parameters<SeedStep['run']>[0]

const PROCESS = '00000000-0000-4000-8000-000000000300'
const GARETH = '00000000-0000-4000-8000-000000000310'
const PRIYA = '00000000-0000-4000-8000-000000000311'
const MEI = '00000000-0000-4000-8000-000000000312'
const TOM = '00000000-0000-4000-8000-000000000313'
const ANNA = '00000000-0000-4000-8000-000000000315'
const AAV9 = '00000000-0000-4000-8000-000000000320'
const LVV = '00000000-0000-4000-8000-000000000321'
const AMBR = '00000000-0000-4000-8000-000000000322'

const ASSISTANT = 'Sheetbase assistant, pinned 2026-08'

type Mode = 'never' | 'allowed' | 'needs_approval' | 'needs_signature'
interface Policy {
  read: Mode
  notebook_blocks: Mode
  dataset_flags: Mode
  create_records: Mode
  messages: Mode
}
const policy = (overrides: Partial<Policy>): Policy => ({
  read: 'allowed',
  notebook_blocks: 'never',
  dataset_flags: 'never',
  create_records: 'never',
  messages: 'never',
  ...overrides,
})

const DEFINITIONS = [
  {
    id: 'AG-0001',
    name: 'Range checker',
    kind: 'rule',
    owner: MEI,
    trigger: 'Any new snapshot with range rules',
    projects: [] as string[],
    description:
      'Checks every new snapshot against the range rules in its schema and proposes a flag for each value outside them.',
    reads: ['Datasets with range rules'],
    proposes: 'Dataset flags · needs e-signature',
    model: null,
    enabled: true,
    policy: policy({ dataset_flags: 'needs_signature', messages: 'allowed' }),
  },
  {
    id: 'AG-0002',
    name: 'Stability summary message',
    kind: 'rule',
    owner: TOM,
    trigger: 'Mondays 07:00',
    projects: [LVV],
    description:
      'Posts the week’s 2–8 °C hold pulls to the team channel every Monday.',
    reads: ['LVV stability datasets'],
    proposes: 'Messages to Teams #lvv-stability · allowed',
    model: null,
    enabled: true,
    policy: policy({ messages: 'allowed' }),
  },
  {
    id: 'AG-0003',
    name: 'Step yield figure',
    kind: 'ai',
    owner: GARETH,
    trigger: 'New DS-0311 snapshot',
    projects: [AAV9],
    description:
      'When DS-0311 gets a new snapshot, recalculates step yield per filter load and proposes an updated chart block in the EXP-0142 notebook.',
    reads: [
      'DS-0311 ELISA capsid titre and turbidity',
      'EXP-0142 notebook (read-only)',
      'AN-0057 step yield analysis',
    ],
    proposes: 'Notebook blocks in EXP-0142 · needs approval',
    model: ASSISTANT,
    enabled: true,
    policy: policy({
      notebook_blocks: 'needs_approval',
      messages: 'needs_approval',
    }),
  },
  {
    id: 'AG-0005',
    name: 'Plate sample registrar',
    kind: 'rule',
    owner: PRIYA,
    trigger: 'Plate map uploaded',
    projects: [AAV9],
    description:
      'Registers a sample record for each well of an uploaded plate map.',
    reads: ['Uploaded plate maps'],
    proposes: 'Sample records · needs e-signature',
    model: null,
    enabled: true,
    policy: policy({ create_records: 'needs_signature' }),
  },
  {
    id: 'AG-0006',
    name: 'Methods drafter',
    kind: 'ai',
    owner: GARETH,
    trigger: 'Asked from a notebook',
    projects: [AAV9, LVV],
    description:
      'Drafts a notebook’s Methods section from the protocol version it follows, when someone asks.',
    reads: [
      'The protocol version the experiment follows',
      'The notebook (read-only)',
    ],
    proposes: 'Notebook blocks · needs approval',
    model: ASSISTANT,
    enabled: true,
    policy: policy({ notebook_blocks: 'needs_approval' }),
  },
  {
    id: 'AG-0008',
    name: 'Ambr unit tidy-up',
    kind: 'ai',
    owner: TOM,
    trigger: 'New DS-0298 snapshot',
    projects: [AMBR],
    description:
      'Proposes a unit for every column that was imported without one.',
    reads: ['DS-0298 Ambr 250 daily readings'],
    proposes: 'Dataset flags · needs approval',
    model: ASSISTANT,
    enabled: false,
    policy: policy({ dataset_flags: 'needs_approval' }),
  },
]

/** Runs per workflow: [number, outcome, list headline, history line, started at (Sep 2026, BST)]. */
const RUNS: Record<string, Array<[number, string, string, string, string]>> = {
  'AG-0003': [
    [
      26,
      'no_change',
      'No change',
      'Nothing new to propose',
      '2026-09-19T11:05:00+01:00',
    ],
    [
      27,
      'no_change',
      'No change',
      'Nothing new to propose',
      '2026-09-21T09:40:00+01:00',
    ],
    [
      28,
      'no_change',
      'No change',
      'Nothing new to propose',
      '2026-09-22T11:05:00+01:00',
    ],
    [
      29,
      'proposed',
      'Rejected',
      'plate 3 missing',
      '2026-09-23T15:40:00+01:00',
    ],
    [
      30,
      'proposed',
      'Approved',
      'EXP-0142 rev 23',
      '2026-09-24T17:02:00+01:00',
    ],
    [31, 'proposed', '1 proposal', '', '2026-09-25T10:12:00+01:00'],
  ],
  'AG-0002': [
    [
      6,
      'sent',
      'Sent',
      'Weekly summary posted to #lvv-stability',
      '2026-09-22T07:00:00+01:00',
    ],
  ],
  'AG-0005': [
    [
      7,
      'no_change',
      'No change',
      'No new plate map',
      '2026-09-23T09:20:00+01:00',
    ],
    [
      8,
      'no_change',
      'No change',
      'No new plate map',
      '2026-09-24T09:20:00+01:00',
    ],
    [9, 'proposed', 'Waiting for approval', '', '2026-09-25T09:20:00+01:00'],
  ],
  'AG-0006': [
    [11, 'no_change', 'No change', 'Not asked', '2026-09-21T14:00:00+01:00'],
    [
      12,
      'proposed',
      'Approved',
      'EXP-0139 Methods',
      '2026-09-22T10:30:00+01:00',
    ],
    [13, 'no_change', 'No change', 'Not asked', '2026-09-23T13:10:00+01:00'],
    [14, 'proposed', 'Waiting for approval', '', '2026-09-24T15:30:00+01:00'],
  ],
  'AG-0008': [
    [
      4,
      'proposed',
      'Approved',
      'Unit for Alanine',
      '2026-09-23T16:10:00+01:00',
    ],
    [
      5,
      'failed',
      'Execution failed',
      'Glucose already has a unit',
      '2026-09-24T09:31:00+01:00',
    ],
  ],
}

const REVISIONS = [
  {
    revision: 12,
    by: MEI,
    at: '2026-09-02T16:45:00+01:00',
    ref: 'CC-0219',
    summary: 'Plate registrar records → e-signature',
    reason: 'plate registrar records now need e-signature',
  },
  {
    revision: 13,
    by: GARETH,
    at: '2026-09-09T11:02:00+01:00',
    ref: 'CC-0226',
    summary: 'Added Ambr unit tidy-up',
    reason: 'added Ambr unit tidy-up',
  },
  {
    revision: 14,
    by: ANNA,
    at: '2026-09-18T14:20:00+01:00',
    ref: 'CC-0231',
    summary: 'Range checker flags → e-signature',
    reason: 'range checker flags now need e-signature',
  },
]

interface Rendered {
  sections: Array<{
    kind: 'unchanged' | 'added' | 'changed' | 'removed'
    title: string
    subtitle?: string
    table?: { columns: string[]; rows: string[][] }
    caption?: string
  }>
  footer?: string
}

interface SeedProposal {
  display: string
  agent: string
  subject: string
  title: string
  context: string
  risk: 'high' | 'medium' | 'low'
  kind: string
  state: 'mine' | 'waiting' | 'approved' | 'rejected' | 'failed'
  signature: boolean
  approver: string
  approverRole: string
  at: string
  target: string
  summary: string
  evidence: Array<{ label: string; value: string; href?: string }>
  confidence?: { level: string; note: string }
  rendered: Rendered
  run?: number
  reason?: string
}

const PROPOSALS: SeedProposal[] = [
  {
    display: 'PR-0412',
    agent: 'AG-0003',
    subject: 'EXP-0142',
    title: 'Add a “Step yield by filter load” chart block after Figure 1',
    context: 'run #31 · EXP-0142 notebook · Results',
    risk: 'high',
    kind: 'notebook_block.insert',
    state: 'mine',
    signature: false,
    approver: GARETH,
    approverRole: 'notebook owner',
    at: '2026-09-25T10:12:00+01:00',
    target: 'EXP-0142 notebook · Results · rev 23',
    summary:
      'Adds a chart of mean step yield per filter train for the new DS-0311 snapshot.',
    evidence: [
      {
        label: 'Source',
        value: 'DS-0311 snapshot S-15 · 96 rows',
        href: '/datasets/DS-0311',
      },
      { label: 'Snapshot hash', value: 'sha256:9c1e…4b7a' },
      {
        label: 'Calculation',
        value: 'AN-0057 v4, same as Figure 1',
        href: '/analysis',
      },
      { label: 'Excludes', value: 'Row 88 (C-150), flagged out of range' },
    ],
    confidence: {
      level: 'High',
      note: 'All 96 rows of S-15 used; no flagged values in the calculation.',
    },
    rendered: {
      sections: [
        {
          kind: 'unchanged',
          title: 'Figure 1',
          subtitle: 'Step yield by filter load (S-14)',
        },
        {
          kind: 'added',
          title: 'Step yield by filter load (S-15)',
          table: {
            columns: ['Load', 'Train A', 'Train B'],
            rows: [
              ['50 L/m²', '88.1 %', '86.4 %'],
              ['100 L/m²', '84.7 %', '81.9 %'],
              ['150 L/m²', '79.2 %', '62.8 %'],
            ],
          },
          caption:
            'Mean step yield per filter train, loads 50–150 L/m². Row 88 excluded.',
        },
      ],
      footer:
        'Added after Figure 1 in the EXP-0142 notebook. Figure 1 and everything else stay as they are.',
    },
    run: 31,
  },
  {
    display: 'PR-0411',
    agent: 'AG-0001',
    subject: 'DS-0311',
    title: 'Flag turbidity 61.5 NTU as out of range',
    context: 'run #412 · DS-0311 row 88 · SMP-2248 · C-150',
    risk: 'high',
    kind: 'dataset_rows.commit',
    state: 'mine',
    signature: true,
    approver: GARETH,
    approverRole: 'dataset owner',
    run: 412,
    at: '2026-09-25T10:11:00+01:00',
    target: 'DS-0311 · row 88 · Turbidity out',
    summary: 'Flags one value; the row stays in the dataset.',
    evidence: [
      { label: 'Source', value: 'DS-0311 snapshot S-15 · row 88' },
      { label: 'Rule', value: 'Turbidity out ≤ 20 NTU (schema range rule)' },
      { label: 'Value', value: '61.5 NTU, 3× the limit' },
    ],
    confidence: {
      level: 'High',
      note: 'The value is outside the schema range.',
    },
    rendered: {
      sections: [
        {
          kind: 'changed',
          title: 'Turbidity out · row 88',
          subtitle: '61.5 NTU',
          caption:
            'Flagged out of range. The value is kept and excluded from calculations.',
        },
      ],
    },
  },
  {
    display: 'PR-0409',
    agent: 'AG-0005',
    subject: 'EXP-0142',
    title: 'Create 24 sample records for ELISA plate 5',
    context: 'run #9 · Samples · ELISA plate 5',
    risk: 'medium',
    kind: 'record.create',
    state: 'mine',
    signature: true,
    approver: GARETH,
    approverRole: 'experiment owner',
    run: 9,
    at: '2026-09-25T09:20:00+01:00',
    target: 'EXP-0142 · Samples · ELISA plate 5',
    summary: 'Registers one sample per well of the uploaded plate map.',
    evidence: [
      { label: 'Source', value: 'PR-01_EXP-0142_plate5.csv · 24 wells' },
      { label: 'Plate map', value: 'ELISA plate 5, wells A1–C8' },
    ],
    confidence: {
      level: 'Medium',
      note: 'Well labels matched the plate layout; two replicates share a name.',
    },
    rendered: {
      sections: [
        {
          kind: 'added',
          title: '24 sample records',
          subtitle: 'ELISA plate 5, wells A1–C8',
          caption: 'Each is created in EXP-0142 with its well as the name.',
        },
      ],
    },
  },
  {
    display: 'PR-0407',
    agent: 'AG-0006',
    subject: 'EXP-0138',
    title: 'Draft the Methods section from PRT-021 v4',
    context: 'run #14 · EXP-0138 notebook · Methods',
    risk: 'medium',
    kind: 'notebook_block.insert',
    state: 'waiting',
    signature: false,
    approver: MEI,
    approverRole: 'notebook owner',
    run: 14,
    at: '2026-09-24T15:30:00+01:00',
    target: 'EXP-0138 notebook · Methods',
    summary:
      'Drafts the Methods section from the protocol version the experiment follows.',
    evidence: [
      { label: 'Source', value: 'PRT-021 v4, effective 2026-09-14' },
      { label: 'Asked by', value: 'Gareth P., from the EXP-0138 notebook' },
    ],
    rendered: {
      sections: [
        {
          kind: 'added',
          title: 'Methods',
          caption: 'Eight steps from PRT-021 v4, written in the past tense.',
        },
      ],
    },
  },
  {
    display: 'PR-0406',
    agent: 'AG-0002',
    subject: 'PRJ-0214',
    title: 'Post a one-off summary of the 2–8 °C hold week 6 pull',
    context: 'run #7 · Teams #lvv-stability',
    risk: 'high',
    kind: 'record.comment.create',
    state: 'waiting',
    signature: false,
    approver: TOM,
    approverRole: 'project lead',
    at: '2026-09-24T12:00:00+01:00',
    target: 'Teams #lvv-stability',
    summary: 'Posts a summary of the week 6 pull to the team channel.',
    evidence: [{ label: 'Source', value: 'LVV stability, week 6 pull' }],
    rendered: {
      sections: [
        {
          kind: 'added',
          title: 'Message to #lvv-stability',
          caption:
            'Week 6 pull: titre 3.1 × 10¹⁰ vg/mL, within the 2–8 °C hold limits.',
        },
      ],
    },
  },
  {
    display: 'PR-0405',
    agent: 'AG-0003',
    subject: 'EXP-0142',
    title: 'Update Figure 1 from DS-0311 S-14',
    context: 'run #30 · EXP-0142 notebook · Results',
    risk: 'high',
    kind: 'notebook_block.update',
    state: 'approved',
    signature: false,
    approver: GARETH,
    approverRole: 'notebook owner',
    at: '2026-09-24T17:05:00+01:00',
    target: 'EXP-0142 notebook · Results · rev 22',
    summary: 'Updates Figure 1 to the S-14 snapshot.',
    evidence: [{ label: 'Source', value: 'DS-0311 snapshot S-14 · 94 rows' }],
    rendered: {
      sections: [
        {
          kind: 'changed',
          title: 'Figure 1',
          subtitle: 'Step yield by filter load (S-13 → S-14)',
        },
      ],
    },
    run: 30,
  },
  {
    display: 'PR-0403',
    agent: 'AG-0003',
    subject: 'EXP-0142',
    title: 'Update Figure 1 from DS-0311 S-13',
    context: 'run #29 · EXP-0142 notebook · Results',
    risk: 'medium',
    kind: 'notebook_block.update',
    state: 'rejected',
    signature: false,
    approver: GARETH,
    approverRole: 'notebook owner',
    at: '2026-09-23T16:02:00+01:00',
    target: 'EXP-0142 notebook · Results · rev 21',
    summary: 'Updates Figure 1 to the S-13 snapshot.',
    evidence: [{ label: 'Source', value: 'DS-0311 snapshot S-13 · 72 rows' }],
    rendered: {
      sections: [
        {
          kind: 'changed',
          title: 'Figure 1',
          subtitle: 'Step yield by filter load (S-12 → S-13)',
        },
      ],
    },
    run: 29,
    reason: 'Plate 3 is missing from S-13.',
  },
  {
    display: 'PR-0402',
    agent: 'AG-0008',
    subject: 'DS-0298',
    title: 'Set unit g/L on the Glucose column',
    context: 'run #5 · DS-0298 · Glucose column',
    risk: 'high',
    kind: 'dataset_rows.commit',
    state: 'failed',
    signature: false,
    approver: TOM,
    approverRole: 'dataset owner',
    run: 5,
    at: '2026-09-24T09:31:00+01:00',
    target: 'DS-0298 · Glucose column',
    summary: 'Sets the unit on a column that was imported without one.',
    evidence: [
      { label: 'Source', value: 'DS-0298 import, 84 rows missing a unit' },
    ],
    rendered: {
      sections: [
        { kind: 'changed', title: 'Glucose', subtitle: 'unit: none → g/L' },
      ],
    },
  },
]

export async function seedDesignAgentRegistry(db: Db): Promise<void> {
  const { rows: existing } = await db.execute(
    sql`select 1 from api.agent_definitions where workspace_id = ${PROCESS} and display_id = 'AG-0003' limit 1`,
  )
  if (existing.length > 0) return

  const definitionIds = new Map<string, string>()
  for (const d of DEFINITIONS) {
    const { rows } = await db.execute(sql`
      insert into api.agent_definitions
        (workspace_id, display_id, name, kind, description, trigger_label, project_ids,
         owner_user_id, model_label, reads, proposes, enabled, policy)
      values (${PROCESS}, ${d.id}, ${d.name}, ${d.kind}, ${d.description}, ${d.trigger},
              ${sql.raw(`ARRAY[${d.projects.map((p) => `'${p}'`).join(',')}]::uuid[]`)},
              ${d.owner}, ${d.model}, ${sql.raw(`ARRAY[${d.reads.map((r) => `'${r.replace(/'/g, "''")}'`).join(',')}]::text[]`)},
              ${d.proposes}, ${d.enabled}, ${JSON.stringify(d.policy)}::jsonb)
      returning id`)
    definitionIds.set(d.id, (rows as Array<{ id: string }>)[0].id)
  }

  // The range checker runs on every snapshot: 42 runs this week, the last one
  // proposing the flag.
  const rangeChecker = definitionIds.get('AG-0001')!
  await db.execute(sql`
    insert into api.agent_runs (workspace_id, definition_id, run_number, outcome, summary, detail, started_at)
    select ${PROCESS}, ${rangeChecker}, n,
           case when n = 412 then 'proposed' else 'no_change' end,
           case when n = 412 then '1 flag proposed' else 'No change' end,
           case when n = 412 then '' else 'Nothing out of range' end,
           timestamptz '2026-09-25 10:11:00+01' - ((412 - n) * interval '3 hours')
      from generate_series(371, 412) n`)

  const runIds = new Map<string, string>()
  const { rows: flagged } = await db.execute(
    sql`select id from api.agent_runs where definition_id = ${rangeChecker} and run_number = 412`,
  )
  runIds.set('AG-0001#412', (flagged as Array<{ id: string }>)[0].id)
  for (const [agent, runs] of Object.entries(RUNS)) {
    for (const [number, outcome, summary, detail, at] of runs) {
      const { rows } = await db.execute(sql`
        insert into api.agent_runs (workspace_id, definition_id, run_number, outcome, summary, detail, started_at)
        values (${PROCESS}, ${definitionIds.get(agent)!}, ${number}, ${outcome}, ${summary}, ${detail}, ${at}::timestamptz)
        returning id`)
      runIds.set(`${agent}#${number}`, (rows as Array<{ id: string }>)[0].id)
    }
  }

  for (const r of REVISIONS) {
    await db.execute(sql`
      insert into api.agent_policy_revisions
        (workspace_id, revision, summary, change_ref, reason, changed_by_user_id, signed_meaning, changed_at)
      values (${PROCESS}, ${r.revision}, ${r.summary}, ${r.ref}, ${r.reason}, ${r.by},
              'I approve this change', ${r.at}::timestamptz)`)
  }

  const { rows: credentials } = await db.execute(
    sql`select id from internal.api_credentials where workspace_id = ${PROCESS} and name = 'Seed agent credential' limit 1`,
  )
  const credentialId = (credentials as Array<{ id: string }>)[0]?.id ?? null

  const recordId = async (identifier: string) => {
    const { rows } = await db.execute(
      sql`select id, structure_version from api.records where workspace_id = ${PROCESS} and identifier = ${identifier} limit 1`,
    )
    return (rows as Array<{ id: string; structure_version: number }>)[0] ?? null
  }

  const provenance = (agent: string, name: string, model: boolean) => ({
    agentId: agent.toLowerCase(),
    agentName: name,
    tool: { name: 'sheetbase.notebook.propose', version: '1' },
    model: model
      ? { provider: 'anthropic', name: 'claude' }
      : { provider: 'rule', name: 'rule' },
    invocationId: `seed-${agent.toLowerCase()}`,
  })

  for (const p of PROPOSALS) {
    const definition = DEFINITIONS.find((d) => d.id === p.agent)!
    const prov = provenance(p.agent, definition.name, definition.kind === 'ai')
    let proposalId: string | null = null

    // A notebook block the person can really approve and execute.
    if (p.kind === 'notebook_block.insert') {
      const record = await recordId(p.subject)
      if (record) {
        proposalId = await withDesignClaims(
          db,
          GARETH,
          PROCESS,
          async (client) => {
            const block =
              p.display === 'PR-0412'
                ? {
                    type: 'chart',
                    payload: {
                      title: 'Step yield by filter load (S-15)',
                      source: 'Clarification runs',
                    },
                  }
                : {
                    type: 'rich_text',
                    payload: {
                      title: 'Methods',
                      doc: {
                        type: 'doc',
                        content: [
                          {
                            type: 'paragraph',
                            content: [
                              {
                                type: 'text',
                                text: 'Cells were harvested and clarified following PRT-021 v4.',
                              },
                            ],
                          },
                        ],
                      },
                    },
                  }
            try {
              const { rows } = await client.query<{ id: string }>(
                'select id from api.propose_agent_operation($1,$2,$3,$4::jsonb,$5::jsonb,$6)',
                [
                  PROCESS,
                  p.title,
                  p.summary,
                  JSON.stringify({
                    kind: 'notebook_block.insert',
                    recordId: record.id,
                    afterBlockId: null,
                    block,
                    expectedRevision: record.structure_version,
                  }),
                  JSON.stringify(prov),
                  `seed-agent-${p.display}`,
                ],
              )
              return rows[0]?.id ?? null
            } catch {
              return null
            }
          },
        )
      }
    }

    const approved = p.state === 'approved'
    const status =
      p.state === 'mine' || p.state === 'waiting'
        ? 'pending'
        : p.state === 'approved'
          ? 'succeeded'
          : p.state === 'rejected'
            ? 'rejected'
            : 'failed'
    const evidence = {
      evidence: p.evidence,
      confidence: p.confidence ?? null,
      risk: p.risk,
      approverRole: p.approverRole,
    }
    const target = {
      identifier: p.subject,
      label: p.target,
      context: p.context,
    }
    const summaryChange = { rendered: p.rendered }

    if (proposalId) {
      await db.execute(sql`
        update api.agent_operation_proposals
           set display_id = ${p.display}, agent_definition_id = ${definitionIds.get(p.agent)!},
               agent_run_id = ${p.run ? (runIds.get(`${p.agent}#${p.run}`) ?? null) : null},
               approver_user_id = ${p.approver}, signature_required = ${p.signature},
               policy_evidence = ${JSON.stringify(evidence)}::jsonb,
               policy_target = ${JSON.stringify(target)}::jsonb,
               preview = preview || ${JSON.stringify(summaryChange)}::jsonb,
               risk_class = 'consequential_write', approval_policy = 'human_required',
               created_at = ${p.at}::timestamptz, updated_at = ${p.at}::timestamptz
         where id = ${proposalId}`)
      continue
    }

    const operation = { kind: p.kind, seeded: true }
    const preview = {
      formatVersion: 1,
      kind: p.kind,
      target: { type: 'record', id: null, label: p.target },
      changes: [],
      ...summaryChange,
    }
    const impact = {
      formatVersion: 1,
      mutationClass: 'content',
      target: { type: 'record', id: null, label: p.target },
      createsDraft: false,
      affectedRows: p.display === 'PR-0409' ? 24 : 1,
      destructive: false,
    }
    await db.execute(sql`
      insert into api.agent_operation_proposals
        (workspace_id, title, summary, operation_kind, operation, preview, impact,
         risk_class, approval_policy, policy_reason, status, idempotency_key, request_digest,
         provenance, proposed_by_credential_id, display_id, agent_definition_id, agent_run_id,
         approver_user_id, signature_required, policy_evidence, policy_target,
         approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, rejection_reason,
         executed_by_user_id, executed_at, error_code, error_message, created_at, updated_at)
      values (${PROCESS}, ${p.title}, ${p.summary}, ${p.kind}, ${JSON.stringify(operation)}::jsonb,
              ${JSON.stringify(preview)}::jsonb, ${JSON.stringify(impact)}::jsonb,
              'consequential_write', 'human_required',
              'A person approves each proposal.', ${status}, ${`seed-agent-${p.display}`},
              ${'a'.repeat(63) + (PROPOSALS.indexOf(p) % 10)}, ${JSON.stringify(prov)}::jsonb, ${credentialId},
              ${p.display}, ${definitionIds.get(p.agent)!},
              ${p.run ? (runIds.get(`${p.agent}#${p.run}`) ?? null) : null},
              ${p.approver}, ${p.signature}, ${JSON.stringify(evidence)}::jsonb, ${JSON.stringify(target)}::jsonb,
              ${approved || p.state === 'failed' ? p.approver : null},
              ${approved || p.state === 'failed' ? p.at : null}::timestamptz,
              ${p.state === 'rejected' ? p.approver : null},
              ${p.state === 'rejected' ? p.at : null}::timestamptz,
              ${p.state === 'rejected' ? p.reason : null},
              ${approved || p.state === 'failed' ? p.approver : null},
              ${approved || p.state === 'failed' ? p.at : null}::timestamptz,
              ${p.state === 'failed' ? 'unit_conflict' : null},
              ${p.state === 'failed' ? 'Glucose already has a unit in S-15, so the change was not written.' : null},
              ${p.at}::timestamptz, ${p.at}::timestamptz)`)
  }

  // Link each run that produced a proposal to it.
  await db.execute(sql`
    update api.agent_runs r set proposal_id = p.id
      from api.agent_operation_proposals p
     where p.agent_run_id = r.id and r.workspace_id = ${PROCESS}`)
}
