import { describe, expect, it } from 'vitest'

import type { ModelFieldDefinition } from '#/lib/model-fields'
import {
  fieldShowsOn,
  parseChoices,
  withArticle,
} from './built-in-model-fields'

describe('built-in model field authoring', () => {
  it('reads choices one per line, without blanks or repeats', () => {
    expect(parseChoices('Pass\n\n Fail \nPass\nRe-test')).toEqual([
      { key: 'pass', label: 'Pass' },
      { key: 'fail', label: 'Fail' },
      { key: 're_test', label: 'Re-test' },
    ])
  })

  it('says where a field shows in plain words', () => {
    const base = {
      askOnCreate: true,
      showInList: false,
    } as ModelFieldDefinition
    expect(fieldShowsOn(base)).toBe('Record page, create form')
    expect(
      fieldShowsOn({ ...base, askOnCreate: false, showInList: true }),
    ).toBe('Record page, list column')
  })

  it('uses the right article for the model', () => {
    expect(withArticle('experiment')).toBe('an experiment')
    expect(withArticle('sample')).toBe('a sample')
  })
})
