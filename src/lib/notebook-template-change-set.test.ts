import { describe, expect, it } from 'vitest'

import { changeSetFromVersions } from './notebook-template-change-set'
import type {
  NotebookTemplateConfiguration,
  NotebookTemplatePlacement,
} from './notebook-template'
import type { Parameter } from './parameter'

const P1 = '00000000-0000-4000-8000-000000000010'
const P2 = '00000000-0000-4000-8000-000000000011'
const D1 = '00000000-0000-4000-8000-000000000020'
const D2 = '00000000-0000-4000-8000-000000000021'
const T1 = '00000000-0000-4000-8000-000000000030'

function sheet(
  overrides: Partial<
    Extract<NotebookTemplatePlacement, { kind: 'sheet' }>
  > = {},
): NotebookTemplatePlacement {
  return {
    id: P1,
    kind: 'sheet',
    order: 1,
    definitionVersionId: D1,
    title: 'Samples',
    parameterMappings: [],
    ...overrides,
  }
}

function narrative(id: string): NotebookTemplatePlacement {
  return {
    id,
    kind: 'narrative',
    order: 2,
    blockType: 'rich_text',
    payload: { doc: { type: 'doc', content: [] } },
  }
}

function parameter(overrides: Partial<Parameter> = {}): Parameter {
  return {
    id: T1,
    key: 'results',
    label: 'Results',
    required: true,
    type: { kind: 'scalar', valueType: 'text' },
    constraints: {},
    ...overrides,
  }
}

function config(
  placements: NotebookTemplatePlacement[],
  parameters: Parameter[] = [],
): NotebookTemplateConfiguration {
  return { formatVersion: 1, parameters, placements }
}

describe('changeSetFromVersions', () => {
  it('treats the first version as all added', () => {
    const entries = changeSetFromVersions(
      undefined,
      config([sheet()], [parameter()]),
    )
    expect(entries.every((entry) => entry.tag === 'added')).toBe(true)
    expect(entries.map((entry) => entry.label)).toContain('Sheet · Samples')
    expect(entries.map((entry) => entry.label)).toContain('Parameter · Results')
  })

  it('reports a re-pinned sheet with before → after', () => {
    const entries = changeSetFromVersions(
      config([sheet({ definitionVersionId: D1 })]),
      config([sheet({ definitionVersionId: D2 })]),
    )
    expect(entries).toEqual([
      {
        id: P1,
        kind: 'placement',
        tag: 'changed',
        label: 'Sheet · Samples',
        field: 'Sheet definition version',
        before: D1,
        after: D2,
      },
    ])
  })

  it('reports removed and added placements', () => {
    const entries = changeSetFromVersions(
      config([sheet(), narrative(P2)]),
      config([sheet()]),
    )
    expect(entries).toEqual([
      {
        id: P2,
        kind: 'placement',
        tag: 'removed',
        label: 'Block · rich_text',
        before: expect.any(String),
      },
    ])

    const added = changeSetFromVersions(
      config([sheet()]),
      config([sheet(), narrative(P2)]),
    )
    expect(added).toEqual([
      {
        id: P2,
        kind: 'placement',
        tag: 'added',
        label: 'Block · rich_text',
        after: expect.any(String),
      },
    ])
  })

  it('reports a changed parameter field', () => {
    const entries = changeSetFromVersions(
      config([sheet()], [parameter({ required: true })]),
      config([sheet()], [parameter({ required: false })]),
    )
    expect(entries).toEqual([
      {
        id: T1,
        kind: 'parameter',
        tag: 'changed',
        label: 'Parameter · Results',
        field: 'required',
        before: 'Required',
        after: 'Optional',
      },
    ])
  })

  it('reports nothing when the definitions match', () => {
    expect(changeSetFromVersions(config([sheet()]), config([sheet()]))).toEqual(
      [],
    )
  })
})
