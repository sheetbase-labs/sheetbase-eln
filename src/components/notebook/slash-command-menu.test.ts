import { describe, expect, it } from 'vitest'

import {
  slashCommandFilterCount,
  slashCommandFilteredOptions,
} from './slash-command-menu'

describe('slashCommandFilteredOptions', () => {
  it('matches scientist aliases such as image, dataset and table', () => {
    expect(slashCommandFilteredOptions('image').map((opt) => opt.type)).toEqual(
      ['file'],
    )
    expect(
      slashCommandFilteredOptions('dataset').map((opt) => opt.type),
    ).toContain('linked_record')
    expect(slashCommandFilteredOptions('table').map((opt) => opt.type)).toEqual(
      ['sheet', 'table'],
    )
  })

  it('matches descriptions and keeps grouped option order', () => {
    expect(slashCommandFilterCount('')).toBeGreaterThan(0)
    expect(slashCommandFilteredOptions('heading')[0]?.type).toBe('rich_text')
  })
})
