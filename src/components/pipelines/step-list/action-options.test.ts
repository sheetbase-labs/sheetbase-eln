import { describe, expect, it } from 'vitest'

import { pipelineActions } from '#/lib/operations/registry'
import { actionArea, actionOptions } from './action-options'

describe('actionOptions', () => {
  const options = actionOptions(pipelineActions())

  it('offers every pipeline action once', () => {
    expect(new Set(options.map((o) => o.id)).size).toBe(
      pipelineActions().length,
    )
  })

  it('gives each a group, a mark and what it does', () => {
    for (const o of options) {
      expect(o.group).toBeTruthy()
      expect(o.icon).toBeTruthy()
      expect(o.detail).toBeTruthy()
    }
  })

  it('lists the record and notebook actions first', () => {
    expect(options.slice(0, 2).map((o) => o.group)).toEqual([
      'Records',
      'Records',
    ])
    expect(actionArea('insert_block')).toBe('Notebook')
    expect(actionArea('create_model_record')).toBe('Records')
    expect(actionArea('record_qc_point')).not.toBe('Records')
  })

  it('keeps each group together', () => {
    const seen: string[] = []

    for (const o of options) {
      if (seen.at(-1) !== o.group) {
        expect(seen).not.toContain(o.group)
        seen.push(o.group ?? '')
      }
    }
  })

  it('marks the actions that can be proposed', () => {
    const insert = options.find((o) => o.id === 'insert_block')

    expect(insert?.status?.label).toBe('Can propose')
  })

  it('puts plugin actions under Plugins', () => {
    expect(actionArea('plugin.k.summarise-values')).toBe('Plugins')
  })
})
