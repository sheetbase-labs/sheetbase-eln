/**
 * MODEL-03 — unit tests for the relationship-rule client policy: pure
 * allowability mirrors of the server trigger grain, counting, label feed,
 * and SB080/SB081 rejection matchers. No PostgREST required except the
 * fetcher/RPC shapes, which assert wire mapping against a mocked client.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  allowedLinkTypes,
  allowedTargetModels,
  configureModelRelationshipRule,
  countLinksForRule,
  fetchModelRelationshipRules,
  isLinkAllowed,
  isReferenceTargetAllowed,
  isRelationshipCardinalityError,
  isRelationshipNotAllowedError,
  relationshipRuleStatus,
  relationshipTypeLabels,
  removeModelRelationshipRule,
  resolveRelationshipLabel,
  rulesForLinkType,
  toModelRelationshipRule,
} from './model-relationships'
import type { ModelRelationshipRule } from './model-relationships'
import type { DataClient } from './data-client'

function rule(overrides: Partial<ModelRelationshipRule> = {}): ModelRelationshipRule {
  return {
    id: 'rule-1',
    sourceModelKey: 'experiment',
    linkType: 'sample',
    targetModelKey: 'sample',
    minLinks: 0,
    maxLinks: null,
    label: null,
    ...overrides,
  }
}

function mockClient(): DataClient & { list: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn().mockResolvedValue([]),
    rpc: vi.fn().mockResolvedValue({}),
    insert: vi.fn(),
    patch: vi.fn(),
    count: vi.fn(),
    remove: vi.fn(),
  } as unknown as DataClient & { list: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> }
}

describe('toModelRelationshipRule', () => {
  it('maps the snake_case wire row to the client rule', () => {
    expect(
      toModelRelationshipRule({
        id: 'r1',
        source_model_key: 'experiment',
        link_type: 'sample',
        target_model_key: 'sample',
        min_links: 1,
        max_links: 8,
        label: 'consumes',
      }),
    ).toEqual({
      id: 'r1',
      sourceModelKey: 'experiment',
      linkType: 'sample',
      targetModelKey: 'sample',
      minLinks: 1,
      maxLinks: 8,
      label: 'consumes',
    })
  })
})

describe('fetchModelRelationshipRules', () => {
  it('scopes the PostgREST query to the source model when given', async () => {
    const client = mockClient()
    client.list.mockResolvedValue([])
    await fetchModelRelationshipRules(client, 'experiment')
    expect(client.list).toHaveBeenCalledWith(
      'model_relationship_rules',
      expect.stringContaining('source_model_key=eq.experiment'),
    )
  })

  it('reads the whole workspace rule set without a scope', async () => {
    const client = mockClient()
    client.list.mockResolvedValue([])
    await fetchModelRelationshipRules(client)
    expect(client.list).toHaveBeenCalledWith(
      'model_relationship_rules',
      expect.not.stringContaining('source_model_key=eq.'),
    )
  })
})

describe('stewardship RPCs', () => {
  it('declares a rule through configure_model_relationship_rule', async () => {
    const client = mockClient()
    await configureModelRelationshipRule(client, {
      workspaceId: 'ws-1',
      sourceModelKey: 'experiment',
      linkType: 'sample',
      targetModelKey: 'sample',
      minLinks: 1,
      maxLinks: 8,
      label: 'consumes',
    })
    expect(client.rpc).toHaveBeenCalledWith('configure_model_relationship_rule', {
      p_workspace_id: 'ws-1',
      p_source_model_key: 'experiment',
      p_link_type: 'sample',
      p_target_model_key: 'sample',
      p_min_links: 1,
      p_max_links: 8,
      p_label: 'consumes',
    })
  })

  it('removes a rule through remove_model_relationship_rule', async () => {
    const client = mockClient()
    await removeModelRelationshipRule(client, 'rule-1')
    expect(client.rpc).toHaveBeenCalledWith('remove_model_relationship_rule', {
      p_rule_id: 'rule-1',
    })
  })
})

describe('isLinkAllowed', () => {
  it('closes the world per source model once any rule is declared', () => {
    const rules = [rule()]
    expect(
      isLinkAllowed(rules, {
        sourceModelKey: 'experiment',
        linkType: 'protocol',
        targetModelKey: 'protocol_template',
      }),
    ).toBe(false)
  })

  it('leaves models with no rules at all unrestricted', () => {
    expect(
      isLinkAllowed([], {
        sourceModelKey: 'sample',
        linkType: 'sample',
        targetModelKey: 'sample',
      }),
    ).toBe(true)
  })

  it('allows a declared type/target pair and rejects an unlisted target', () => {
    const rules = [rule()]
    expect(
      isLinkAllowed(rules, {
        sourceModelKey: 'experiment',
        linkType: 'sample',
        targetModelKey: 'sample',
      }),
    ).toBe(true)
    expect(
      isLinkAllowed(rules, {
        sourceModelKey: 'experiment',
        linkType: 'sample',
        targetModelKey: 'reagent',
      }),
    ).toBe(false)
  })

  it('scopes rules to their source model', () => {
    const rules = [rule()]
    expect(
      isLinkAllowed(rules, {
        sourceModelKey: 'sample',
        linkType: 'sample',
        targetModelKey: 'reagent',
      }),
    ).toBe(true)
  })
})

describe('allowedTargetModels / allowedLinkTypes', () => {
  it('returns null when nothing is declared (unrestricted)', () => {
    expect(allowedTargetModels([], 'experiment', 'sample')).toBeNull()
    expect(allowedLinkTypes([], 'experiment')).toBeNull()
  })

  it('lists declared targets and constrained types', () => {
    const rules = [
      rule({ linkType: 'sample', targetModelKey: 'sample' }),
      rule({ id: 'rule-2', linkType: 'protocol', targetModelKey: 'protocol_template' }),
    ]
    expect(allowedTargetModels(rules, 'experiment', 'sample')).toEqual(['sample'])
    expect(allowedLinkTypes(rules, 'experiment')).toEqual(['sample', 'protocol'])
    expect(allowedTargetModels(rules, 'experiment', 'reagent')).toEqual([])
  })
})

describe('isReferenceTargetAllowed', () => {
  it('is unrestricted without rules and aggregates across link types with rules', () => {
    expect(isReferenceTargetAllowed([], 'experiment', 'reagent')).toBe(true)
    const rules = [rule({ linkType: 'sample', targetModelKey: 'sample' })]
    expect(isReferenceTargetAllowed(rules, 'experiment', 'sample')).toBe(true)
    expect(isReferenceTargetAllowed(rules, 'experiment', 'reagent')).toBe(false)
  })
})

describe('counting and status', () => {
  const links = [
    { linkType: 'sample', targetKind: 'sample' },
    { linkType: 'sample', targetKind: 'sample' },
    { linkType: 'protocol', targetKind: 'protocol_template' },
  ]

  it('counts only edges matching the rule type and target', () => {
    expect(countLinksForRule(links, rule())).toBe(2)
    expect(
      countLinksForRule(links, rule({ linkType: 'protocol', targetModelKey: 'protocol_template' })),
    ).toBe(1)
  })

  it('resolves target kinds through a model-kind map when given', () => {
    expect(
      countLinksForRule(links, rule({ targetModelKey: 'bio_sample' }), {
        sample: 'bio_sample',
      }),
    ).toBe(2)
  })

  it('reports min satisfaction and remaining capacity', () => {
    expect(relationshipRuleStatus(rule({ minLinks: 1, maxLinks: 8 }), 0)).toEqual({
      count: 0,
      minSatisfied: false,
      remaining: 8,
      atMaximum: false,
    })
    expect(relationshipRuleStatus(rule({ minLinks: 1, maxLinks: 2 }), 2)).toEqual({
      count: 2,
      minSatisfied: true,
      remaining: 0,
      atMaximum: true,
    })
    expect(relationshipRuleStatus(rule(), 5)).toMatchObject({
      remaining: null,
      atMaximum: false,
    })
  })
})

describe('KNOW label feed', () => {
  it('prefers the rule-declared name and falls back to the canonical vocabulary', () => {
    const rules = [rule({ linkType: 'sample', label: 'consumes' })]
    expect(relationshipTypeLabels(rules)).toEqual({ sample: 'consumes' })
    expect(resolveRelationshipLabel('sample', rules)).toBe('consumes')
    expect(resolveRelationshipLabel('protocol', rules)).toBe('defined by')
  })

  it('passes undeclared types through verbatim without rules', () => {
    expect(resolveRelationshipLabel('custom_type')).toBe('custom_type')
  })
})

describe('server rejection matchers', () => {
  it('matches SB080 by code or message', () => {
    expect(isRelationshipNotAllowedError({ code: 'SB080', message: 'x' })).toBe(true)
    expect(
      isRelationshipNotAllowedError({
        code: '400',
        message: 'link type sample to model reagent is not allowed for model experiment',
      }),
    ).toBe(true)
    expect(isRelationshipNotAllowedError({ code: 'SB002', message: 'x' })).toBe(false)
    expect(isRelationshipCardinalityError({ code: 'SB080', message: 'x' })).toBe(false)
  })

  it('matches SB081 by code or message', () => {
    expect(isRelationshipCardinalityError({ code: 'SB081', message: 'x' })).toBe(true)
    expect(
      isRelationshipCardinalityError({
        code: '400',
        message: 'link type sample to model sample exceeds the maximum of 2 for model experiment',
      }),
    ).toBe(true)
    expect(isRelationshipCardinalityError({ code: 'SB080', message: 'x' })).toBe(false)
  })
})

describe('rulesForLinkType', () => {
  it('selects the declared pair grain', () => {
    const rules = [
      rule(),
      rule({ id: 'rule-2', linkType: 'protocol', targetModelKey: 'protocol_template' }),
    ]
    expect(rulesForLinkType(rules, 'experiment', 'sample')).toHaveLength(1)
    expect(rulesForLinkType(rules, 'experiment', 'reagent')).toHaveLength(0)
  })
})
