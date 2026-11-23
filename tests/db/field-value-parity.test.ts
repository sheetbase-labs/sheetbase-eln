/**
 * The record form and the Sheet check a typed value with validateModelFieldValue
 * before it is sent; internal.validate_model_fields is what decides when it
 * arrives. Each field type is given the same values both ways, and any value
 * one side accepts and the other refuses is listed.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  modelFieldValidationForServer,
  validateModelFieldValue,
} from '#/lib/model-fields'
import type {
  ModelFieldDefinition,
  ModelFieldLogicalType,
  ModelFieldValidation,
} from '#/lib/model-fields'

import { prepareTestDatabase } from './helpers'

const WS = '00000000-0000-4000-8000-00000000f301'
const OWNER = 'fvp-owner'

let migrator: Client
let asRole: (role: 'authenticator') => Promise<Client>
let owner: Client

interface Case {
  type: ModelFieldLogicalType
  validation: ModelFieldValidation
  values: unknown[]
}

const CASES: Case[] = [
  {
    type: 'text',
    validation: { minLength: 2, maxLength: 5, pattern: '^[a-z]+$' },
    values: ['ab', 'abcde', 'a', 'abcdef', 'AB', '', 5, true, ['x'], {}],
  },
  {
    type: 'integer',
    validation: { min: 0, max: 10 },
    values: [0, 10, -1, 11, 3.5, '3', true, 1e2, null],
  },
  {
    type: 'decimal',
    validation: { min: 0 },
    values: [0, 0.5, -0.5, '0.5', false, 12345678.123],
  },
  {
    type: 'boolean',
    validation: {},
    values: [true, false, 'true', 1, 0],
  },
  {
    type: 'date',
    validation: {},
    values: ['2026-01-02', '2026-02-30', '2026-13-01', 'not a date', 20260102],
  },
  {
    type: 'timestamp',
    validation: {},
    values: [
      '2026-01-02T10:00:00Z',
      '2026-01-02 10:00',
      '2026-01-02',
      'nope',
      1700000000,
    ],
  },
]

beforeAll(async () => {
  ;({ migrator, asRole } = await prepareTestDatabase())
  await migrator.query(`
    insert into internal."user"(id,name,email,"emailVerified") values
      ('${OWNER}','Owner','fvp-owner@test.invalid',true);
    insert into api.workspaces(id,slug,name) values('${WS}','field-values','Field values');
    insert into api.workspace_memberships(workspace_id,user_id,role) values('${WS}','${OWNER}','owner')`)
  owner = await asRole('authenticator')
  await owner.query('SET ROLE authenticated')
  await owner.query(`select set_config('request.jwt.claims',$1,false)`, [
    JSON.stringify({ sub: OWNER, workspace_id: WS, role: 'authenticated' }),
  ])

  for (const { type, validation } of CASES) {
    await owner.query(
      `select * from api.create_model_field($1,'sample',$2,$2,$3,true,null,$4::jsonb)`,
      [
        WS,
        `fvp_${type}`,
        type,
        JSON.stringify(modelFieldValidationForServer(validation)),
      ],
    )
  }

  await migrator.query(
    `update api.record_field_definitions set lifecycle='active' where workspace_id=$1 and kind='sample' and field_name like 'fvp\\_%'`,
    [WS],
  )
})

afterAll(async () => {
  await owner?.end()
  await migrator?.end()
})

function definitionOf(
  type: ModelFieldLogicalType,
  validation: ModelFieldValidation,
): ModelFieldDefinition {
  return {
    id: `fvp-${type}`,
    modelKey: 'sample',
    fieldName: `fvp_${type}`,
    label: type,
    description: null,
    displayOrder: 0,
    logicalType: type,
    nullable: true,
    defaultValue: null,
    unit: null,
    validation,
    lifecycle: 'active',
    options: [],
  }
}

describe('the app and the database accept the same field values', () => {
  it('agrees on every value given to every field type', async () => {
    const gaps: string[] = []

    for (const { type, validation, values } of CASES) {
      const definition = definitionOf(type, validation)

      for (const value of values) {
        const app = validateModelFieldValue(definition, value) === null
        let database = true

        try {
          await migrator.query(
            `select internal.validate_model_fields($1,'sample',$2::jsonb)`,
            [WS, JSON.stringify({ [`fvp_${type}`]: value })],
          )
        } catch {
          database = false
        }

        if (app !== database) {
          gaps.push(
            `${type} ${JSON.stringify(value)}: app ${app ? 'accepts' : 'refuses'}, database ${database ? 'accepts' : 'refuses'}`,
          )
        }
      }
    }

    expect(
      gaps,
      'validateFieldValue in src/lib/field-value-validation.ts and internal.validate_model_fields disagree',
    ).toEqual([])
  })
})
