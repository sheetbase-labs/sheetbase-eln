import { describe, expect, it } from 'vitest'

import {
  placeholderNames,
  resolveWebCallBody,
  resolveWebCallPath,
  rowsFromAnswer,
  webCallProblem,
} from './web-call'
import { validatePipelineConfig } from './config'

const call = {
  connection: 'lims',
  method: 'GET',
  path: '/batches?project={parameters.project}',
}

describe('webCallProblem', () => {
  it('accepts a call that names a connection, a method and a path', () => {
    expect(webCallProblem(call, ['project'])).toBeNull()
    expect(
      webCallProblem(
        { ...call, method: 'POST', body: { project: '{parameters.project}' } },
        ['project'],
      ),
    ).toBeNull()
  })

  it('says what is missing, field by field', () => {
    expect(webCallProblem(call, [])?.field).toBe('path')
    expect(
      webCallProblem({ ...call, connection: 'Lims' }, ['project'])?.field,
    ).toBe('connection')
    expect(webCallProblem({ ...call, method: 'PUT' }, ['project'])?.field).toBe(
      'method',
    )
    expect(
      webCallProblem({ ...call, path: 'batches' }, ['project'])?.field,
    ).toBe('path')
    expect(
      webCallProblem({ ...call, secret: 'bad name' }, ['project'])?.field,
    ).toBe('secret')
    expect(
      webCallProblem({ ...call, itemsPath: 'a..b' }, ['project'])?.field,
    ).toBe('itemsPath')
    expect(webCallProblem({ ...call, body: {} }, ['project'])?.field).toBe(
      'body',
    )
    expect(webCallProblem('nope', [])?.field).toBe('')
  })
})

describe('placeholders', () => {
  it('finds the settings a path names and fills them in, encoded', () => {
    expect(placeholderNames('/a/{parameters.x}?b={parameters.y_1}')).toEqual([
      'x',
      'y_1',
    ])
    expect(
      resolveWebCallPath('/batches?name={parameters.name}', {
        name: 'AAV9 & co/1',
      }),
    ).toBe('/batches?name=AAV9%20%26%20co%2F1')
    expect(resolveWebCallPath('/n/{parameters.n}', { n: 4 })).toBe('/n/4')
  })

  it('fills the text values inside a body', () => {
    expect(
      resolveWebCallBody(
        { q: '{parameters.p}', nested: { list: ['{parameters.p}', 1] } },
        { p: 'x' },
      ),
    ).toEqual({ q: 'x', nested: { list: ['x', 1] } })
  })
})

describe('rowsFromAnswer', () => {
  it('reads a list as one row each, keeping a nested value as text', () => {
    expect(
      rowsFromAnswer(
        { data: { items: [{ a: 1, tags: ['x'] }, { a: 2 }] } },
        'data.items',
      ),
    ).toEqual([{ a: 1, tags: '["x"]' }, { a: 2 }])
  })

  it('reads one object as a row and a plain value as `value`', () => {
    expect(rowsFromAnswer({ a: 1 }, undefined)).toEqual([{ a: 1 }])
    expect(rowsFromAnswer([1, 'x'], '')).toEqual([{ value: 1 }, { value: 'x' }])
  })

  it('says nothing when the path leads nowhere', () => {
    expect(rowsFromAnswer({ a: 1 }, 'b')).toBeNull()
    expect(rowsFromAnswer({ a: null }, 'a.b')).toBeNull()
  })
})

describe('a web call step in a version', () => {
  const config = (step: {
    onlyIfRows?: boolean
    webCall?: object
    statement?: string
  }) => ({
    configVersion: 2,
    mode: 'standard',
    parameters: [{ name: 'project', type: 'text', required: true }],
    inputs: [],
    steps: [{ name: 'lims', kind: 'web_call', webCall: call, ...step }],
    output: { mode: 'none' },
  })

  it('is valid, and may be skipped when the step before gave no rows', () => {
    expect(validatePipelineConfig(config({}))).toEqual([])
    expect(validatePipelineConfig(config({ onlyIfRows: true }))).toEqual([])
  })

  it('names the field that is wrong', () => {
    const errors = validatePipelineConfig(
      config({ webCall: { ...call, method: 'DELETE' } }),
    )

    expect(errors.map((e) => e.field)).toEqual(['steps[0].webCall.method'])
  })

  it('refuses a setting that belongs to another kind', () => {
    const errors = validatePipelineConfig(config({ statement: 'select 1' }))

    expect(errors.length).toBeGreaterThan(0)
  })
})
