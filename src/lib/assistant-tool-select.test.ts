import { describe, expect, it } from 'vitest'

import type { ProviderToolDef } from './ai-providers/types'
import { selectTools } from './assistant-tool-select'

function def(name: string): ProviderToolDef {
  return { name, description: name, parameters: { type: 'object' } }
}

describe('selectTools', () => {
  it('always offers the plan tool, so dependent changes can travel as one plan', () => {
    const defs = [
      def('sheetbase__plan__propose'),
      def('sheetbase__sample__move'),
    ]

    const names = selectTools(defs, 'hello', new Set()).map((d) => d.name)

    expect(names).toContain('sheetbase__plan__propose')
    expect(names).not.toContain('sheetbase__sample__move')
  })

  it('offers the blockers read for why questions', () => {
    const defs = [
      def('sheetbase__blockers__read'),
      def('sheetbase__sample__move'),
    ]

    for (const question of [
      'What is stopping EXP-0142 from being submitted for review?',
      'Why is DS-0311 flagged?',
      'What is holding up my experiments?',
    ]) {
      expect(selectTools(defs, question, new Set()).map((d) => d.name)).toEqual(
        ['sheetbase__blockers__read'],
      )
    }
  })
})
