import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'
import { describe, expect, it } from 'vitest'

import { parseSearchAnswer, searchInstruction } from './ai-search-filters'

const fields: SheetbaseField[] = [
  {
    id: 'type',
    label: 'Type',
    dataType: 'text',
    options: ['sample', 'experiment'],
  },
  {
    id: 'project',
    label: 'Project',
    dataType: 'text',
    loadOptions: async (q: string) =>
      [{ value: 'p-1', label: 'AAV8 TFF' }].filter((o) =>
        o.label.toLowerCase().includes(q.toLowerCase()),
      ),
  },
  { id: 'updated', label: 'Updated', dataType: 'date' },
  { id: 'fields.titre', label: 'Titre', dataType: 'number' },
]

describe('parseSearchAnswer', () => {
  it('builds an editable filter tree from a good answer', async () => {
    const answer = JSON.stringify({
      text: 'buffer',
      match: 'all',
      filters: [
        { field: 'type', operator: 'eq', value: 'Sample' },
        { field: 'project', operator: 'eq', value: 'AAV8 TFF' },
        { field: 'updated', operator: 'withinLastDays', value: 7 },
        { field: 'fields.titre', operator: 'gt', value: '2.5' },
      ],
    })

    const out = await parseSearchAnswer(answer, fields)
    expect(out?.q).toBe('buffer')
    expect(out?.skipped).toEqual([])

    const kids = out?.filter?.children as unknown as Array<{
      field: string
      value: unknown
    }>

    expect(kids.map((c) => [c.field, c.value])).toEqual([
      ['type', 'sample'],
      ['project', 'p-1'],
      ['updated', 7],
      ['fields.titre', 2.5],
    ])
  })

  it('skips fields, operators and options that do not exist', async () => {
    const answer = JSON.stringify({
      filters: [
        { field: 'colour', operator: 'eq', value: 'red' },
        { field: 'fields.titre', operator: 'contains', value: '2' },
        { field: 'type', operator: 'eq', value: 'spaceship' },
        { field: 'project', operator: 'eq', value: 'Nonexistent' },
        { field: 'type', operator: 'eq', value: 'sample' },
      ],
    })

    const out = await parseSearchAnswer(answer, fields)
    expect(out?.skipped).toHaveLength(4)
    expect(out?.filter?.children).toHaveLength(1)
  })

  it('uses OR when the question said or', async () => {
    const out = await parseSearchAnswer(
      JSON.stringify({
        match: 'any',
        filters: [
          { field: 'type', operator: 'in', value: ['sample', 'experiment'] },
        ],
      }),
      fields,
    )

    expect(out?.filter?.combinator).toBe('OR')
  })

  it('returns null for an unreadable answer', async () => {
    expect(await parseSearchAnswer('sorry', fields)).toBeNull()
  })
})

describe('searchInstruction', () => {
  it('gives today, the question and the fields', () => {
    const text = searchInstruction('samples last week', fields, '2026-11-03')
    expect(text).toContain('Today is 2026-11-03.')
    expect(text).toContain('- type | Type | text')
    expect(text).toContain('choices: sample, experiment')
  })
})
