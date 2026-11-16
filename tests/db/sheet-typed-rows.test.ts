import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { validSheetDefinitionConfiguration } from '../fixtures/sheet-definition'
import { grantProjectAccess, prepareTestDatabase } from './helpers'

const WS = '06600000-0000-4000-8000-000000000001'
const PROJECT = '06600000-0000-4000-8000-000000000003'
const OWNER = 'typed-rows-owner'
const PLACEMENT = '06600000-0000-4000-8000-000000000011'
const NOTE_COLUMN = '06600000-0000-4000-8000-0000000000a1'
const TOTAL_COLUMN = '06600000-0000-4000-8000-0000000000a2'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
const clients: Client[] = []

async function actor(userId: string) {
  const client = await asRole('authenticator')
  clients.push(client)
  await client.query('SET ROLE authenticated')
  await client.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: userId, workspace_id: WS, role: 'authenticated' }),
  ])

  return client
}

type Column = { id: string }

/** A Definition whose rows are typed in: a reference identity and two typed columns. */
function typedInConfiguration() {
  const base = validSheetDefinitionConfiguration()
  const [first] = base.columns

  const identity = {
    ...first,
    source: { kind: 'declared' as const },
    field: {
      ...first.field,
      logicalType: 'reference' as const,
      relationship: {
        target: { kind: 'model' as const, modelKey: 'sample' },
        cardinality: 'one' as const,
      },
    },
  }

  const note = {
    id: NOTE_COLUMN,
    source: { kind: 'declared' as const },
    field: {
      ...first.field,
      fieldId: NOTE_COLUMN,
      key: 'note',
      label: 'Note',
      logicalType: 'text' as const,
      relationship: null,
    },
  }

  const total = {
    id: TOTAL_COLUMN,
    source: { kind: 'declared' as const },
    field: {
      ...note.field,
      fieldId: TOTAL_COLUMN,
      key: 'total',
      label: 'Total',
    },
  }

  return {
    ...base,
    parameters: [],
    bindings: [],
    joins: [],
    columns: [identity, note, total],
    calculations: [],
    writeBackRules: [],
    actions: [],
    rowIdentity: { kind: 'local' as const, columnIds: [identity.id] },
    presentation: {
      columnOrder: [identity.id, NOTE_COLUMN, TOTAL_COLUMN],
      hiddenColumnIds: [],
      columnWidths: {},
      frozenColumnCount: 0,
      density: 'standard' as const,
    },
  }
}

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())

  await migrator.query(
    `insert into internal."user"(id,name,email,"emailVerified") values ($1,'Owner','typed-rows-owner@test.invalid',true)`,
    [OWNER],
  )

  await migrator.query(
    `insert into api.workspaces(id,slug,name) values ($1,'typed-rows','Typed rows')`,
    [WS],
  )

  await migrator.query(
    `insert into api.workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')`,
    [WS, OWNER],
  )

  await migrator.query(
    `insert into api.projects(id,workspace_id,key,title,lead_user_id) values ($1,$2,'TYR','Typed rows',$3)`,
    [PROJECT, WS, OWNER],
  )

  await grantProjectAccess(migrator, {
    workspaceId: WS,
    projectId: PROJECT,
    userId: OWNER,
    canView: true,
    canEdit: true,
  })
})

afterAll(async () => {
  await Promise.all(clients.map((client) => client.end()))
  await migrator?.end()
})

describe('typed-in sheet rows', () => {
  it('opens a template sheet with its own rows, columns and cells', async () => {
    const owner = await actor(OWNER)

    const definition = (
      await owner.query(
        `select api.create_sheet_definition($1,'typed_rows','Typed rows',null,$2::jsonb) result`,
        [WS, JSON.stringify(typedInConfiguration())],
      )
    ).rows[0].result

    await owner.query(`select api.publish_sheet_definition_version($1,$2)`, [
      definition.version.id,
      definition.version.revision,
    ])

    const template = (
      await owner.query(
        `select api.create_notebook_template($1,'typed_rows_tpl','Typed rows',null,$2::jsonb) result`,
        [
          WS,
          JSON.stringify({
            formatVersion: 1,
            parameters: [],
            placements: [
              {
                id: PLACEMENT,
                kind: 'sheet',
                order: 1,
                definitionVersionId: definition.version.id,
                parameterMappings: [],
              },
            ],
          }),
        ],
      )
    ).rows[0].result

    const published = (
      await owner.query(
        `select to_jsonb(api.publish_notebook_template_version($1,$2,'Published')) result`,
        [template.version.id, template.version.revision],
      )
    ).rows[0].result

    const created = (
      await owner.query(
        `select api.instantiate_notebook_template_version($1,$2,'Run','[]'::jsonb,'typed-1') result`,
        [published.id, PROJECT],
      )
    ).rows[0].result

    const instance = (
      await owner.query(
        `select i.id, i.revision, i.state from api.sheet_instances i
          where i.notebook_record_id = $1`,
        [created.record.id],
      )
    ).rows[0]

    // The row identity is fixed at creation: there is no source to wait for.
    expect(instance.state.resolvedRowIdentity.kind).toBe('local')

    // Reading it answers with the Definition's columns and no source rows.
    const composition = (
      await owner.query(
        `select api.query_sheet_instance_rows($1,50,0) result`,
        [instance.id],
      )
    ).rows[0].result

    expect(composition.rows).toEqual([])
    expect(composition.identity.kind).toBe('local')
    expect(composition.hasMore).toBe(false)

    expect(
      composition.definitionConfiguration.columns.map(
        (column: Column) => column.id,
      ),
    ).toContain(NOTE_COLUMN)

    const mutate = (cells: unknown[], rowKey: string, revision: number) =>
      owner.query(
        `select to_jsonb(api.mutate_sheet_instance_local_state($1,$2,gen_random_uuid(),'[]'::jsonb,$3::jsonb,$4::jsonb)) result`,
        [
          instance.id,
          revision,
          JSON.stringify([{ kind: 'local', rowKey }]),
          JSON.stringify(cells),
        ],
      )

    // A typed cell in a declared column of the pinned Definition is kept.
    const rowKey = crypto.randomUUID()

    const saved = (
      await mutate(
        [{ rowKey, fieldId: NOTE_COLUMN, value: 'first pass' }],
        rowKey,
        Number(instance.revision),
      )
    ).rows[0].result

    expect(saved.state.localValues[rowKey][NOTE_COLUMN]).toBe('first pass')

    // A column the Definition does not declare is still refused.
    const stranger = '06600000-0000-4000-8000-0000000000ff'
    const otherRow = crypto.randomUUID()

    await expect(
      mutate(
        [{ rowKey: otherRow, fieldId: stranger, value: 'x' }],
        otherRow,
        Number(saved.revision),
      ),
    ).rejects.toThrow(/unknown or retired local field/)
  })
})
