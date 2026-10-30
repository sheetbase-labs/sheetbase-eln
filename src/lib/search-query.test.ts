import { describe, expect, it } from 'vitest'
import type { SheetbaseField } from '@sheetbase-labs/sheetbase-shared'

import { countConditions } from './search-filter'
import { parseTypedSearch } from './search-query'

const projects = [{ value: 'p-1', label: 'AAV8 TFF' }]
const fields: SheetbaseField[] = [
  {
    id: 'type',
    label: 'Type',
    dataType: 'text',
    loadOptions: async () => [{ value: 'sample', label: 'Sample' }],
  },
  {
    id: 'project',
    label: 'Project',
    dataType: 'text',
    loadOptions: async (query) =>
      projects.filter(
        (p) =>
          p.value === query ||
          p.label.toLowerCase().includes(query.toLowerCase()),
      ),
  },
]

describe('typed search', () => {
  it('turns tokens into filters and keeps the rest as words', async () => {
    const typed = await parseTypedSearch(
      'buffer type:sample -project:"AAV8 TFF" -tris',
      fields,
    )
    expect(typed.q).toBe('buffer -tris')
    expect(typed.filter && countConditions(typed.filter)).toBe(2)
  })

  it('looks a typed project name up so the filter holds its id', async () => {
    const typed = await parseTypedSearch('project:"AAV8 TFF"', fields)
    expect(JSON.stringify(typed.filter)).toContain('"p-1"')
  })

  it('leaves unknown keys as words', async () => {
    const typed = await parseTypedSearch('colour:red plate', fields)
    expect(typed).toEqual({ q: 'colour:red plate' })
  })
})
