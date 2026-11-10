import { describe, expect, it } from 'vitest'

import type { NotebookTemplatePlacement } from '#/lib/notebook-template'
import type { SheetDefinitionVersion } from '#/lib/sheet-definition-data'
import {
  describeSections,
  diffTemplatePlacements,
  numericRule,
  summariseTemplateChanges,
} from './template-structure'

const id = (n: number) => `00000000-0000-4000-8000-0000000000${n}`

function column(
  n: number,
  label: string,
  validation = {},
): SheetDefinitionVersion['configuration']['columns'][number] {
  return {
    id: id(n),
    field: {
      fieldId: id(n),
      key: label.toLowerCase(),
      label,
      description: null,
      logicalType: 'decimal',
      nullable: false,
      defaultValue: null,
      cardinality: 'one',
      quantity: null,
      validation,
      category: null,
      relationship: null,
      computation: { mode: 'stored' },
      lifecycle: 'active',
    },
    source: { kind: 'declared' },
  }
}

function sheet(
  versionId: string,
  columns: SheetDefinitionVersion['configuration']['columns'],
): SheetDefinitionVersion {
  return {
    id: versionId,
    definitionId: id(90),
    version: 1,
    lifecycle: 'published',
    revision: 1,
    publishedAt: null,
    retiredAt: null,
    configuration: {
      formatVersion: 1,
      parameters: [],
      bindings: [],
      rowIdentity: { kind: 'local', columnIds: [id(11)] },
      joins: [],
      columns,
      calculations: [],
      writeBackRules: [],
      actions: [],
      presentation: {
        columnOrder: [],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
        filters: [],
        sorts: [],
      },
    },
  }
}

const placement = (definitionVersionId: string): NotebookTemplatePlacement => ({
  id: id(50),
  kind: 'sheet',
  order: 1,
  definitionVersionId,
  title: 'Runs',
  parameterMappings: [],
})

describe('template structure helpers', () => {
  it('formats numeric rules', () => {
    expect(numericRule({ min: 10, max: 300 })).toBe('10–300')
    expect(numericRule({ max: 1.5 })).toBe('≤ 1.5')
    expect(numericRule({})).toBeNull()
  })

  it('describes sheet sections by column count', () => {
    const lookup = new Map([[id(1), sheet(id(1), [column(11, 'Load')])]])
    const [entry] = describeSections([placement(id(1))], lookup)
    expect(entry.subtitle).toBe('Sheet · 1 columns')
  })

  it('diffs added columns and widened rules between sheet versions', () => {
    const lookup = new Map([
      [id(1), sheet(id(1), [column(11, 'Load', { max: 200 })])],
      [
        id(2),
        sheet(id(2), [
          column(11, 'Load', { max: 300 }),
          column(12, 'Pressure'),
        ]),
      ],
    ])

    const changes = diffTemplatePlacements(
      [placement(id(1))],
      [placement(id(2))],
      lookup,
    )

    expect(changes.map((c) => `${c.kind} ${c.subject}`)).toEqual([
      'Added Pressure column',
      'Changed Load rule',
    ])
    expect(changes[1]).toMatchObject({ from: '≤ 200', to: '≤ 300' })
  })

  it('prefers the version reason in the Change column', () => {
    expect(summariseTemplateChanges([], 'Because', false, 3)).toBe('Because')
    expect(summariseTemplateChanges([], null, true, 6)).toBe(
      'Created with 6 sections',
    )
  })

  it('preserves native protocol versions and reads text before coercing the version', () => {
    const reads: string[] = []

    const narrative: NotebookTemplatePlacement = {
      id: id(60),
      kind: 'narrative',
      order: 1,
      blockType: 'protocol_reference',
      payload: {
        get title() {
          reads.push('title')

          return '  Native protocol  '
        },
        get protocol() {
          reads.push('protocol')

          return ' P-7 '
        },
        get version() {
          reads.push('version')

          return {
            toString() {
              reads.push('coerce')

              return 'native'
            },
          }
        },
      },
    }

    const [entry] = describeSections([narrative], new Map())
    expect(entry.name).toBe('  Native protocol  ')
    expect(entry.subtitle).toBe('From protocol  P-7  vnative')
    expect(reads).toEqual(['title', 'protocol', 'version', 'coerce'])

    for (const { value, expected } of [
      { value: NaN, expected: 'NaN' },
      { value: Infinity, expected: 'Infinity' },
      { value: Symbol('v'), expected: 'Symbol(v)' },
      { value: null, expected: '' },
      { value: new Map(), expected: '[object Map]' },
    ]) {
      expect(
        describeSections(
          [{ ...narrative, payload: { protocol: 'P', version: value } }],
          new Map(),
        )[0].subtitle,
      ).toBe(`From protocol P v${expected}`)
    }

    expect(() =>
      describeSections(
        [
          {
            ...narrative,
            payload: {
              protocol: 'P',
              version: {
                toString() {
                  throw new Error('version coercion')
                },
              },
            },
          },
        ],
        new Map(),
      ),
    ).toThrow('version coercion')
  })

  it('retains per-field custom includes and unchecked second reads in narrative diffs', () => {
    const reads: string[] = []
    let beforeReads = 0
    let afterReads = 0

    const field = {
      toString() {
        reads.push('field coercion')

        return 'Native'
      },
    }

    const before: NotebookTemplatePlacement = {
      id: id(61),
      kind: 'narrative',
      order: 1,
      blockType: 'metric',
      payload: {
        toJSON: () => 'before',
        get fields() {
          reads.push('before fields')

          return ++beforeReads === 1
            ? []
            : {
                includes(value: typeof field) {
                  reads.push('includes')
                  expect(value).toBe(field)

                  return false
                },
              }
        },
      },
    }

    const after: NotebookTemplatePlacement = {
      ...before,
      payload: {
        toJSON: () => 'after',
        get fields() {
          reads.push('after fields')

          return ++afterReads === 1 ? [] : [field]
        },
      },
    }

    expect(diffTemplatePlacements([before], [after], new Map())).toEqual([
      {
        id: `placement:${id(61)}:field:Native field:0:added`,
        kind: 'Added',
        subject: 'Native field',
        detail: 'metric',
      },
    ])
    expect(reads).toEqual([
      'before fields',
      'before fields',
      'after fields',
      'after fields',
      'includes',
      'field coercion',
    ])
  })

  it('retains duplicate native field changes with unique placement-scoped identities and one coercion each', () => {
    const reads: string[] = []

    const first = {
      toString: () => {
        reads.push('first')

        return 'same'
      },
    }

    const second = {
      toString: () => {
        reads.push('second')

        return 'same'
      },
    }

    const before: NotebookTemplatePlacement = {
      id: id(62),
      kind: 'narrative',
      order: 1,
      blockType: 'metric',
      payload: { fields: [] },
    }

    const after: NotebookTemplatePlacement = {
      ...before,
      payload: { fields: [first, first, second, 'same'] },
    }

    const changes = diffTemplatePlacements([before], [after], new Map())
    expect(changes.map(({ subject }) => subject)).toEqual([
      'same field',
      'same field',
      'same field',
      'same field',
    ])
    expect(new Set(changes.map((change) => change.id)).size).toBe(4)
    expect(changes.map((change) => change.id)).toEqual([
      `placement:${id(62)}:field:same field:0:added`,
      `placement:${id(62)}:field:same field:1:added`,
      `placement:${id(62)}:field:same field:2:added`,
      `placement:${id(62)}:field:same field:3:added`,
    ])
    expect(reads).toEqual(['first', 'first', 'second'])
  })
})
