import { describe, expect, it } from 'vitest'

import type { DataClient } from './data-client'
import {
  classifyModelImpactKind,
  countActionableModelImpact,
  discoverModelImpact,
  groupModelImpact,
} from './model-impact'
import type { ObjectDependency } from './object-dependencies'

function item(
  kind: string,
  id: string,
  effect = 'requires_migration',
): ObjectDependency {
  return {
    kind,
    id,
    relation: 'test',
    liveness: 'active',
    effect,
    label: `${kind} ${id}`,
  }
}

describe('model impact client', () => {
  it('calls discover_model_dependencies with the model key', async () => {
    const calls: Array<{ name: string; args: unknown }> = []
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { kind: 'model', id: 'sample', dependencies: [] }
      },
    } as DataClient
    const report = await discoverModelImpact(client, 'sample')
    expect(calls).toEqual([
      { name: 'discover_model_dependencies', args: { p_model_key: 'sample' } },
    ])
    expect(report.dependencies).toEqual([])
  })

  it('classifies dependency kinds into panel groups', () => {
    expect(classifyModelImpactKind('model_field')).toBe('fields')
    expect(classifyModelImpactKind('record')).toBe('records')
    expect(classifyModelImpactKind('project')).toBe('records')
    expect(classifyModelImpactKind('model_relationship_rule')).toBe('rules')
    expect(classifyModelImpactKind('sheet_definition_version')).toBe('sheets')
    expect(classifyModelImpactKind('sheet_instance')).toBe('sheets')
    expect(classifyModelImpactKind('notebook_template_version')).toBe(
      'templates',
    )
    expect(classifyModelImpactKind('something_new')).toBe('other')
  })

  it('groups dependencies in panel order and drops empty groups', () => {
    const groups = groupModelImpact([
      item('notebook_template_version', 't1'),
      item('model_field', 'f1', 'informational'),
      item('record', 'r1'),
      item('sheet_instance', 's1'),
      item('model_relationship_rule', 'rule1'),
    ])
    expect(groups.map((group) => group.group)).toEqual([
      'fields',
      'records',
      'rules',
      'sheets',
      'templates',
    ])
    expect(groups[0].items.map((entry) => entry.id)).toEqual(['f1'])
  })

  it('counts only non-informational dependents as actionable', () => {
    expect(
      countActionableModelImpact([
        item('model_field', 'f1', 'informational'),
        item('record', 'r1'),
        item('model_relationship_rule', 'rule1', 'informational'),
      ]),
    ).toBe(1)
  })
})
