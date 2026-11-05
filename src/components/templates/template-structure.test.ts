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

function column(n: number, label: string, validation = {}) {
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

function sheet(versionId: string, columns: unknown[]) {
  return {
    id: versionId,
    definitionId: id(90),
    version: 1,
    lifecycle: 'published',
    configuration: {
      columns,
      calculations: [],
      presentation: { columnOrder: [] },
    },
  } as unknown as SheetDefinitionVersion
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
})
