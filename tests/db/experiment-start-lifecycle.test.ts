/**
 * EXP-03 / LAB-07 — the controlled experiment lifecycle and its server start gate.
 *
 * `api.start_experiment` is the only transition out of `draft`. It enforces
 * PROJ-03 (`require_effective_protocol`) and LAB-07 (effective version,
 * exact-version acknowledgement, exact project pin) before an experiment can
 * begin, and records the exact version the experiment started on.
 * `api.set_experiment_status` owns the remaining transitions.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import {
  expectDenied,
  grantProjectAccess,
  prepareTestDatabase,
  setActorJwt,
} from './helpers'

const DEFINITION_PARAMETER = '00000000-0000-4000-8000-00000000c1f0'
const WS = '00000000-0000-4000-8000-00000000c100'
const OTHER_WS = '00000000-0000-4000-8000-00000000c101'
const PROJECT = '00000000-0000-4000-8000-00000000c102'
const FREE_PROJECT = '00000000-0000-4000-8000-00000000c103'
const PROTOCOL = '00000000-0000-4000-8000-00000000c104'
const OTHER_PROTOCOL = '00000000-0000-4000-8000-00000000c105'
const AUTHOR = 'exp03-author'
const REVIEWER = 'exp03-reviewer'
const QA = 'exp03-qa'
const TRAINEE = 'exp03-trainee'
const OUTSIDER = 'exp03-outsider'
const ROLES = ['scientist', 'steward', 'reviewer', 'admin', 'owner']

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  for (const user of [AUTHOR, REVIEWER, QA, TRAINEE, OUTSIDER]) {
    await migrator.query(
      `insert into internal."user"(id,name,email,"emailVerified") values($1,$1,$2,true)`,
      [user, `${user}@test.invalid`],
    )
  }
  await migrator.query(
    `insert into api.workspaces(id,slug,name) values($1,'exp03','EXP-03'),($2,'exp03-other','EXP-03 other')`,
    [WS, OTHER_WS],
  )
  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values
     ($1,$2,'owner'),($1,$3,'scientist'),($1,$4,'reviewer'),($1,$5,'scientist'),($6,$7,'owner')`,
    [WS, AUTHOR, REVIEWER, QA, TRAINEE, OTHER_WS, OUTSIDER],
  )
  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,require_effective_protocol) values
     ($1,$2,'EXP03','Controlled experiment project',true),
     ($3,$2,'EXP03FREE','Free experiment project',false)`,
    [PROJECT, WS, FREE_PROJECT],
  )
  await migrator.query(
    `insert into api.records(id,workspace_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,'protocol_template','PRT-EXP03','Clarification protocol','active',$3),
           ($4,$2,'protocol_template','PRT-EXP03B','Second protocol','active',$3)`,
    [PROTOCOL, WS, AUTHOR, OTHER_PROTOCOL],
  )
  for (const protocol of [PROTOCOL, OTHER_PROTOCOL]) {
    await migrator.query(
      `insert into api.blocks(record_id,type,payload,"order",created_by_user_id)
       values($1,'procedure_step',$2::jsonb,1,$3)`,
      [
        protocol,
        JSON.stringify({ text: 'Hold at 2-8 C for 14 days.', stepNumber: 1 }),
        AUTHOR,
      ],
    )
  }
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: AUTHOR,
    canView: true,
    canEdit: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: TRAINEE,
    canView: true,
    canEdit: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: REVIEWER,
    canView: true,
    canReview: true,
  })
  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: FREE_PROJECT,
    userId: AUTHOR,
    canView: true,
    canEdit: true,
  })
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

async function actor(userId: string, workspaceId = WS): Promise<Client> {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('set role authenticated')
  await setActorJwt(client, userId, workspaceId)
  return client
}

async function draftExperiment(
  project = PROJECT,
  owner = AUTHOR,
): Promise<{ id: string; metadataVersion: number }> {
  const id = crypto.randomUUID()
  await migrator.query(
    `insert into api.records(id,workspace_id,project_id,kind,identifier,title,status,created_by_user_id)
     values($1,$2,$3,'experiment',$4,'Controlled experiment','draft',$5)`,
    [id, WS, project, `EXP-${id}`, owner],
  )
  const { rows } = await migrator.query<{ metadata_version: number }>(
    'select metadata_version from api.records where id=$1',
    [id],
  )
  return { id, metadataVersion: rows[0]!.metadata_version }
}

async function newVersion(protocol = PROTOCOL): Promise<string> {
  const author = await actor(AUTHOR)
  const { rows } = await author.query<{ id: string }>(
    `select id from api.create_protocol_version($1,'Controlled version',null)`,
    [protocol],
  )
  const id = rows[0]?.id
  if (!id) throw new Error('create_protocol_version returned no identity')
  await author.query(
    `select api.set_protocol_version_status($1,'in_review','Author submission',null)`,
    [id],
  )
  return id
}

async function approvedVersion(protocol = PROTOCOL): Promise<string> {
  const versionId = await newVersion(protocol)
  const author = await actor(AUTHOR)
  const { rows } = await author.query<{ id: string }>(
    `select id from api.submit_approval_request($1,'protocol_revision',$2,$3,'Author submission',true,2,null)`,
    [WS, versionId, ROLES],
  )
  const requestId = rows[0]?.id
  if (!requestId) throw new Error('submit_approval_request returned no request')
  const reviewer = await actor(REVIEWER)
  await reviewer.query(
    `select api.approve_approval_request($1,'Technical review')`,
    [requestId],
  )
  const qa = await actor(QA)
  await qa.query(`select api.approve_approval_request($1,'QA approval')`, [
    requestId,
  ])
  return versionId
}

async function effectiveVersion(
  pin = true,
  protocol = PROTOCOL,
): Promise<string> {
  const versionId = await approvedVersion(protocol)
  const author = await actor(AUTHOR)
  await author.query(
    `select api.set_protocol_version_status($1,'effective','Release',now())`,
    [versionId],
  )
  if (pin) {
    await setActorJwt(migrator, AUTHOR, WS)
    await migrator.query(
      `insert into api.project_protocols(workspace_id,project_id,protocol_record_id,protocol_version_id,created_by_user_id)
       values($1,$2,$3,$4,$5) on conflict(project_id,protocol_record_id)
       do update set protocol_version_id=excluded.protocol_version_id`,
      [WS, PROJECT, protocol, versionId, AUTHOR],
    )
  }
  return versionId
}

async function start(
  client: Client,
  experiment: { id: string; metadataVersion: number },
  versionId: string | null = null,
  reason: string | null = null,
) {
  return client.query('select * from api.start_experiment($1,$2,$3,$4)', [
    experiment.id,
    experiment.metadataVersion,
    versionId,
    reason,
  ])
}

async function acknowledge(userId: string, versionId: string) {
  const trainee = await actor(userId)
  await trainee.query('select * from api.acknowledge_protocol_version($1)', [
    versionId,
  ])
}

/**
 * A notebook template version whose single parameter is required and mapped, plus the resolved
 * Sheet instance state the notebook would carry. Inserted directly: this exercises the start
 * check, not instantiation, and the instantiation path that would normally produce these rows
 * refuses while a required parameter has no supplied input - which is exactly why the draft
 * being changed afterwards is the case worth covering.
 */
/**
 * A Sheet Definition with one declared reference column and one scalar parameter - the shape
 * `optionalScalarDefinitionConfiguration` uses in the template suite, so the parameter is
 * genuinely declared and its binding list is consistent.
 */
function scalarDefinitionConfiguration(): Record<string, unknown> {
  const configuration = structuredClone(
    validSheetDefinitionConfiguration(),
  ) as Record<string, unknown> & {
    columns: Array<{
      id: string
      source: { kind: string }
      field: { logicalType: string; relationship: unknown }
    }>
  }
  const column = configuration.columns[0]!
  column.source = { kind: 'declared' }
  column.field.logicalType = 'reference'
  column.field.relationship = {
    target: { kind: 'model', modelKey: 'sample' },
    cardinality: 'one',
  }
  configuration.parameters = [
    {
      id: DEFINITION_PARAMETER,
      key: 'passage_count',
      label: 'Passage count',
      required: false,
      type: { kind: 'scalar', valueType: 'integer' },
      constraints: {},
    },
  ]
  configuration.bindings = []
  configuration.joins = []
  configuration.columns = [column]
  configuration.calculations = []
  configuration.writeBackRules = []
  configuration.actions = []
  configuration.rowIdentity = { kind: 'local', columnIds: [column.id] }
  configuration.presentation = {
    columnOrder: [column.id],
    hiddenColumnIds: [],
    columnWidths: {},
    frozenColumnCount: 0,
    density: 'standard',
  }
  return configuration
}

/** The state a freshly created instance carries before any parameters are resolved. */
function emptyInstanceState(): Record<string, unknown> {
  return {
    bindings: [],
    parameterValues: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
    presentation: {
      columnOrder: [],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard',
    },
    provenance: { createdFrom: 'ad_hoc' },
  }
}

async function requiredItemNotebook(
  experimentId: string,
  withValue: boolean,
): Promise<{ templateVersionId: string; key: string }> {
  const key = 'passage_count'
  const templateParameterId = crypto.randomUUID()
  const placementId = crypto.randomUUID()
  const templateId = crypto.randomUUID()
  const templateVersionId = crypto.randomUUID()

  const author = await actor(AUTHOR)
  const definition = (
    await author.query<{ version: { id: string; revision: number } }>(
      `select api.create_sheet_definition($1,$2,'Required items sheet',null,$3::jsonb) result`,
      [
        WS,
        `required_sheet_${templateId.replace(/-/g, '').slice(0, 12)}`,
        JSON.stringify(scalarDefinitionConfiguration()),
      ],
    )
  ).rows[0]!.result
  await author.query(`select api.publish_sheet_definition_version($1,$2)`, [
    definition.version.id,
    definition.version.revision,
  ])

  await migrator.query(
    `insert into api.notebook_templates(id,workspace_id,key,name,lifecycle,created_by_user_id)
     values($1,$2,$3,'Required items','active',$4)`,
    [
      templateId,
      WS,
      `required_${templateId.replace(/-/g, '').slice(0, 12)}`,
      AUTHOR,
    ],
  )
  await migrator.query(
    `insert into api.notebook_template_versions(id,template_id,version,lifecycle,configuration_format_version,configuration,created_by_user_id)
     values($1,$2,1,'draft',1,$3::jsonb,$4)`,
    [
      templateVersionId,
      templateId,
      JSON.stringify({
        formatVersion: 1,
        parameters: [
          {
            id: templateParameterId,
            key,
            label: 'Passage count',
            required: true,
            type: { kind: 'scalar', valueType: 'integer' },
            constraints: {},
          },
        ],
        placements: [
          {
            id: placementId,
            kind: 'sheet',
            order: 1,
            definitionVersionId: definition.version.id,
            parameterMappings: [
              {
                templateParameterId,
                definitionParameterId: DEFINITION_PARAMETER,
              },
            ],
          },
        ],
      }),
      AUTHOR,
    ],
  )
  await migrator.query(
    `update api.records set source_notebook_template_version_id=$2 where id=$1`,
    [experimentId, templateVersionId],
  )

  // The controlled RPC, so the instance and its resolved parameters are written the way the
  // application writes them: supplied when the value is present, unresolved when it is not.
  await author.query(
    `select api.create_sheet_instance_from_definition($1,'Required items',null,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [
      WS,
      definition.version.id,
      PROJECT,
      experimentId,
      JSON.stringify(emptyInstanceState()),
      JSON.stringify(
        withValue
          ? [
              {
                parameterId: DEFINITION_PARAMETER,
                kind: 'scalar',
                value: 4,
              },
            ]
          : [],
      ),
    ],
  )
  return { templateVersionId, key }
}

describe('EXP-03 controlled experiment start and lifecycle', () => {
  it('refuses to start when the project requires an effective protocol and none is pinned', async () => {
    const author = await actor(AUTHOR)
    const experiment = await draftExperiment()
    await expectDenied(start(author, experiment), 'SB110')
  })

  it('enforces exact-version acknowledgement before an experiment can start', async () => {
    const author = await actor(AUTHOR)
    const versionId = await effectiveVersion()
    const experiment = await draftExperiment()
    // Effective and pinned, but this actor has not read and acknowledged it.
    await expectDenied(start(author, experiment), '42501')
    await acknowledge(AUTHOR, versionId)
    await expect(start(author, experiment)).resolves.toBeDefined()
  })

  it('refuses a version that is approved but not yet effective', async () => {
    const author = await actor(AUTHOR)
    const versionId = await approvedVersion()
    const experiment = await draftExperiment()
    await acknowledge(AUTHOR, versionId)
    await expectDenied(start(author, experiment, versionId), '42501')
  })

  it('refuses a version the project is not pinned to', async () => {
    const author = await actor(AUTHOR)
    const pinned = await effectiveVersion()
    // A different protocol is effective in the workspace, but the project's pin
    // still names the first protocol's version.
    const other = await effectiveVersion(false, OTHER_PROTOCOL)
    const experiment = await draftExperiment()
    await acknowledge(AUTHOR, other)
    await expectDenied(start(author, experiment, other), '42501')
    await acknowledge(AUTHOR, pinned)
    await expect(start(author, experiment, pinned)).resolves.toBeDefined()
  })

  it('starts on the effective, acknowledged, pinned version and keeps it', async () => {
    const author = await actor(AUTHOR)
    const versionId = await effectiveVersion()
    await acknowledge(AUTHOR, versionId)
    const experiment = await draftExperiment()
    const { rows } = await start(author, experiment, versionId, 'Begin work')
    expect(rows[0]).toMatchObject({
      status: 'in_progress',
      protocol_version_id: versionId,
      metadata_version: experiment.metadataVersion + 1,
    })
    // A started experiment is no longer a draft, so it cannot start twice.
    await expectDenied(
      start(author, {
        id: experiment.id,
        metadataVersion: rows[0].metadata_version,
      }),
      'SB109',
    )
  })

  it('refuses a stale metadata revision and an outsider', async () => {
    const author = await actor(AUTHOR)
    const versionId = await effectiveVersion()
    await acknowledge(AUTHOR, versionId)
    const experiment = await draftExperiment()
    await expectDenied(
      start(author, {
        id: experiment.id,
        metadataVersion: experiment.metadataVersion + 1,
      }),
      'SB001',
    )
    const outsider = await actor(OUTSIDER, OTHER_WS)
    await expectDenied(start(outsider, experiment), '42501')
  })

  it('starts without a protocol where the project does not require one', async () => {
    const author = await actor(AUTHOR)
    const experiment = await draftExperiment(FREE_PROJECT)
    const { rows } = await start(author, experiment)
    expect(rows[0]).toMatchObject({
      status: 'in_progress',
      protocol_version_id: null,
    })
  })

  it('never starts an experiment through the status RPC', async () => {
    const author = await actor(AUTHOR)
    const experiment = await draftExperiment()
    await expectDenied(
      author.query('select api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        experiment.metadataVersion,
        'in_progress',
        'Sneak past the start gate',
      ]),
      'SB109',
    )
  })

  it('enforces allowed transitions, reasons and review authority', async () => {
    const author = await actor(AUTHOR)
    const reviewer = await actor(REVIEWER)
    const versionId = await effectiveVersion()
    await acknowledge(AUTHOR, versionId)
    const experiment = await draftExperiment()
    const started = (await start(author, experiment, versionId, 'Begin work'))
      .rows[0]

    // draft -> approved is not a transition, and a started experiment is
    // already past draft; in_progress -> approved is illegal too.
    await expectDenied(
      author.query('select api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        started.metadata_version,
        'approved',
        'Skip the review',
      ]),
      'SB111',
    )
    await expectDenied(
      author.query('select api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        started.metadata_version,
        'in_review',
        '',
      ]),
      '22023',
    )
    const submitted = (
      await author.query(
        'select * from api.set_experiment_status($1,$2,$3,$4)',
        [
          experiment.id,
          started.metadata_version,
          'in_review',
          'Ready for review',
        ],
      )
    ).rows[0]
    expect(submitted).toMatchObject({ status: 'in_review' })

    // Approving needs review authority, which the author does not hold.
    await expectDenied(
      author.query('select api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        submitted.metadata_version,
        'approved',
        'Approve my own work',
      ]),
      '42501',
    )
    const approved = (
      await reviewer.query(
        'select * from api.set_experiment_status($1,$2,$3,$4)',
        [
          experiment.id,
          submitted.metadata_version,
          'approved',
          'Independent approval',
        ],
      )
    ).rows[0]
    expect(approved).toMatchObject({ status: 'approved' })

    // An approved experiment can be reopened for amendment, but not re-reviewed.
    await expectDenied(
      reviewer.query('select api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        approved.metadata_version,
        'in_review',
        'Reopen for review',
      ]),
      'SB111',
    )
    const reopened = (
      await author.query(
        'select * from api.set_experiment_status($1,$2,$3,$4)',
        [
          experiment.id,
          approved.metadata_version,
          'in_progress',
          'Amendment after approval',
        ],
      )
    ).rows[0]
    expect(reopened).toMatchObject({ status: 'in_progress' })
  })

  it('refuses to change the status of a locked record', async () => {
    const author = await actor(AUTHOR)
    const experiment = await draftExperiment(FREE_PROJECT)
    const started = (await start(author, experiment)).rows[0]
    const revision = (
      await migrator.query<{ id: string }>(
        `insert into api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,reason,created_by_user_id)
         values($1,1,1,'{}'::jsonb,'[]'::jsonb,'manual',$2) returning id`,
        [experiment.id, AUTHOR],
      )
    ).rows[0]!.id
    await migrator.query(
      'update api.records set locked_at=now(),locked_by_revision_id=$2 where id=$1',
      [experiment.id, revision],
    )
    await expectDenied(
      author.query('select api.set_experiment_status($1,$2,$3,$4)', [
        experiment.id,
        started.metadata_version,
        'in_review',
        'Ready for review',
      ]),
      'SB112',
    )
  })

  it('refuses to start while a required template parameter has no resolved value', async () => {
    const author = await actor(AUTHOR)
    const versionId = await effectiveVersion()
    await acknowledge(AUTHOR, versionId)
    const experiment = await draftExperiment()
    const { key } = await requiredItemNotebook(experiment.id, false)

    const refusal = await start(author, experiment).then(
      () => null,
      (error: { code?: string; message?: string }) => error,
    )
    // The refusal names the item rather than only saying the experiment cannot start, so the
    // user knows what to supply.
    expect(String(refusal?.message)).toContain(key)
    expect(refusal?.code).toBe('SB111')

    const { rows } = await migrator.query<{ status: string }>(
      'select status from api.records where id=$1',
      [experiment.id],
    )
    expect(rows[0]!.status).toBe('draft')
  })

  it('starts once every required template parameter has a resolved value', async () => {
    const author = await actor(AUTHOR)
    const versionId = await effectiveVersion()
    await acknowledge(AUTHOR, versionId)
    const experiment = await draftExperiment()
    await requiredItemNotebook(experiment.id, true)

    const { rows } = await start(author, experiment)
    expect(rows[0]!.status).toBe('in_progress')
  })
})
