import { describe, expect, it } from 'vitest'

import { describeRecordWrite } from './record-writes'

const ID = '11111111-2222-4333-8444-555555555555'

const previous = {
  id: ID,
  identifier: 'EXP-1',
  kind: 'experiment',
  title: 'Titration',
  status: 'draft',
  tags: ['a'],
  properties: {},
  custom_fields: { ph: 7 },
  project_id: null,
}

describe('describeRecordWrite', () => {
  it('sees a record being inserted and can put a fill into the row', () => {
    const [plan] = describeRecordWrite({
      method: 'POST',
      kind: 'table',
      resource: 'records',
      query: '',
      body: JSON.stringify({
        kind: 'sample',
        title: 'S-1',
        custom_fields: { a: 1 },
      }),
    })!

    expect(plan.whens).toEqual(['created'])
    expect(plan.after(null).record).toMatchObject({
      kind: 'sample',
      title: 'S-1',
    })

    const body = JSON.parse(
      plan.withFill({ custom_fields: { b: 2 }, tags: ['x'] })!,
    )

    expect(body).toMatchObject({ custom_fields: { a: 1, b: 2 }, tags: ['x'] })
  })

  it('gives one plan per row of a bulk insert', () => {
    const plans = describeRecordWrite({
      method: 'POST',
      kind: 'table',
      resource: 'records',
      query: '',
      body: JSON.stringify([
        { kind: 'sample', title: 'a' },
        { kind: 'sample', title: 'b' },
      ]),
    })!

    expect(plans).toHaveLength(2)
  })

  it('sees an edit as the record will be, and a status in the body as a status change', () => {
    const [plan] = describeRecordWrite({
      method: 'PATCH',
      kind: 'table',
      resource: 'records',
      query: `?id=eq.${ID}`,
      body: JSON.stringify({ title: 'New', status: 'in_progress' }),
    })!

    expect(plan.recordId).toBe(ID)
    expect(plan.whens).toEqual(['edited', 'status-changed'])
    const { record, changed } = plan.after(previous)
    expect(record).toMatchObject({
      title: 'New',
      status: 'in_progress',
      kind: 'experiment',
    })
    expect(changed.sort()).toEqual(['status', 'title'])
  })

  it('ignores a patch that is not for one record', () => {
    expect(
      describeRecordWrite({
        method: 'PATCH',
        kind: 'table',
        resource: 'records',
        query: '?kind=eq.sample',
        body: '{"title":"x"}',
      }),
    ).toBeNull()
  })

  it('reads the calls that create a record, with custom fields only where the call has them', () => {
    const [plain] = describeRecordWrite({
      method: 'POST',
      kind: 'rpc',
      resource: 'create_record',
      query: '',
      body: JSON.stringify({
        p_kind: 'experiment',
        p_title: 'T',
        p_tags: ['t'],
      }),
    })!

    expect(plain.after(null).record).toMatchObject({
      kind: 'experiment',
      status: 'draft',
      tags: ['t'],
    })
    expect(plain.withFill({ custom_fields: { a: 1 } })).toBeNull()
    expect(JSON.parse(plain.withFill({ tags: ['u'] })!).p_tags).toEqual(['u'])

    const [model] = describeRecordWrite({
      method: 'POST',
      kind: 'rpc',
      resource: 'create_model_record',
      query: '',
      body: JSON.stringify({
        p_kind: 'sample',
        p_title: 'S',
        p_custom_fields: { a: 1 },
      }),
    })!

    expect(
      JSON.parse(model.withFill({ custom_fields: { b: 2 } })!).p_custom_fields,
    ).toEqual({ a: 1, b: 2 })
  })

  it('reads custom field edits and status calls', () => {
    const [edit] = describeRecordWrite({
      method: 'POST',
      kind: 'rpc',
      resource: 'update_record_custom_fields',
      query: '',
      body: JSON.stringify({
        p_record_id: ID,
        p_expected_metadata_version: 1,
        p_values: { ph: 8 },
      }),
    })!

    expect(edit.whens).toEqual(['edited'])
    expect(edit.after(previous).record.custom_fields).toEqual({ ph: 8 })

    for (const [resource, args, status] of [
      [
        'set_experiment_status',
        { p_record_id: ID, p_status: 'in_review' },
        'in_review',
      ],
      [
        'transition_record_status',
        { p_record_id: ID, p_target_status: 'closed' },
        'closed',
      ],
      ['start_experiment', { p_record_id: ID }, 'in_progress'],
      ['release_sample', { p_record_id: ID }, 'released'],
    ] as const) {
      const [plan] = describeRecordWrite({
        method: 'POST',
        kind: 'rpc',
        resource,
        query: '',
        body: JSON.stringify(args),
      })!

      expect(plan.whens).toEqual(['status-changed'])
      expect(plan.after(previous).record.status).toBe(status)
      expect(plan.withFill({ tags: ['x'] })).toBeNull()
    }
  })

  it('keeps JSON values and own scientific keys while malformed snapshot fields fall back', () => {
    const body =
      '{"title":"","status":false,"tags":["valid",4],"properties":{"__proto__":{"units":"µL"},"reading":6.02e23},"custom_fields":[1],"future":{"Δμ":false}}'

    const plan = describeRecordWrite({
      method: 'PATCH',
      kind: 'table',
      resource: 'records',
      query: `id=eq.${ID}`,
      body,
    })?.[0]

    if (!plan) throw new Error('The single-record patch must have a plan')

    expect(plan.whens).toEqual(['edited'])
    expect(plan.after(previous).record).toMatchObject({
      title: '',
      status: 'draft',
      tags: ['a'],
      custom_fields: { ph: 7 },
      properties: JSON.parse('{"__proto__":{"units":"µL"},"reading":6.02e23}'),
    })
    expect(JSON.parse(plan.withFill({ properties: undefined })!)).toEqual(
      JSON.parse(body),
    )
    expect(
      JSON.parse(plan.withFill({ properties: { measured: 0 }, tags: [] })!),
    ).toEqual({
      ...JSON.parse(body),
      properties: JSON.parse(
        '{"__proto__":{"units":"µL"},"reading":6.02e23,"measured":0}',
      ),
      tags: [],
    })
  })

  it('passes over everything else', () => {
    for (const input of [
      {
        method: 'POST',
        kind: 'rpc' as const,
        resource: 'archive_record',
        body: '{}',
      },
      {
        method: 'POST',
        kind: 'table' as const,
        resource: 'blocks',
        body: '{}',
      },
      {
        method: 'GET',
        kind: 'table' as const,
        resource: 'records',
        body: undefined,
      },
      {
        method: 'POST',
        kind: 'rpc' as const,
        resource: 'create_record',
        body: 'not json',
      },
    ])
      expect(describeRecordWrite({ ...input, query: '' })).toBeNull()
  })
})
