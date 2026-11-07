import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '../agent-tool-catalogue'
import { EVENT_CATALOGUE } from '../event-catalogue'
import { PIPELINE_ACTIONS } from '../pipelines/actions'
import { navGroups } from '#/components/shell/nav'
import { FEATURE_NAV_PAGES, MODEL_FEATURES, featureByKey } from './registry'

describe('model feature registry', () => {
  it('has unique keys the database accepts', () => {
    const keys = MODEL_FEATURES.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key).toMatch(/^[a-z][a-z0-9_]{1,39}$/)
  })

  it('names every feature for a scientist, with no developer words', () => {
    for (const feature of MODEL_FEATURES) {
      expect(feature.label().length).toBeGreaterThan(0)
      expect(feature.hint().length).toBeGreaterThan(0)
      expect(`${feature.label()} ${feature.hint()}`).not.toMatch(
        /capabilit|descriptor|contribution|\bRPC\b|\bID\b/i,
      )
    }
  })

  it('lists only assistant tools, pipeline actions and events that exist', () => {
    const tools = new Set<string>(ASSISTANT_PROPOSE_TOOL_NAMES)
    const actions = new Set(PIPELINE_ACTIONS.map((a) => a.rpc))
    const events = new Set(EVENT_CATALOGUE.map((e) => e.name))
    for (const feature of MODEL_FEATURES) {
      for (const tool of feature.contributes.tools ?? [])
        expect(tools.has(tool), `${feature.key}: tool ${tool}`).toBe(true)
      for (const action of feature.contributes.pipelineActions ?? [])
        expect(actions.has(action), `${feature.key}: action ${action}`).toBe(
          true,
        )
      for (const event of feature.contributes.events ?? [])
        expect(events.has(event), `${feature.key}: event ${event}`).toBe(true)
    }
  })

  it('points each feature page at a sidebar page that asks for it', () => {
    const pages = navGroups.flatMap((g) => g.items)
    for (const feature of MODEL_FEATURES) {
      const key = feature.contributes.navPage
      if (!key) continue
      expect(pages.find((p) => p.key === key)?.feature).toBe(feature.key)
    }
    for (const page of pages.filter((p) => p.feature)) {
      expect(FEATURE_NAV_PAGES.get(page.key)).toBe(page.feature)
      expect(featureByKey(page.feature as string)).toBeDefined()
    }
  })
})
