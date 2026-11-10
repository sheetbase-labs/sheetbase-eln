import { describe, expect, it } from 'vitest'

import { defaultAiFeatureFlags } from './ai-feature-flags'
import { createAssistantToolkit } from './assistant-tools.server'
import type { DataClient } from './data-client'

const WORKSPACE = '33333333-3333-4333-8333-333333333333'

async function toolkit(
  flags: Partial<ReturnType<typeof defaultAiFeatureFlags>>,
) {
  return createAssistantToolkit({
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the toolkit builds definitions and reads through `list` only; no other DataClient method is reached here.
    client: { list: () => Promise.resolve([]) } as unknown as DataClient,
    actor: { kind: 'user', id: 'u' },
    workspaceId: WORKSPACE,
    flags: { ...defaultAiFeatureFlags(), ...flags },
  })
}

describe('assistant toolkit proposals', () => {
  it('offers propose tools only when agents may draft', async () => {
    const off = await toolkit({ mcp_draft: false })
    const on = await toolkit({ mcp_draft: true })
    const names = (kit: typeof on) => kit?.defs.map((def) => def.name) ?? []
    expect(names(off)).not.toContain('sheetbase__notebook_block__insert')
    expect(names(on)).toContain('sheetbase__notebook_block__insert')
    expect(names(off)).not.toContain('sheetbase__pipeline_definition__draft')
    expect(names(off)).not.toContain(
      'sheetbase__pipeline_definition__update_draft',
    )
    expect(names(on)).toContain('sheetbase__pipeline_definition__draft')
    expect(names(on)).toContain('sheetbase__pipeline_definition__update_draft')
    expect(off?.instructions).toContain('cannot change')
    expect(on?.instructions).toContain('card')
  })

  it('answers a bad proposal with a message and no card', async () => {
    const kit = await toolkit({ mcp_draft: true })

    const result = await kit!.run(
      'sheetbase__notebook_block__insert',
      JSON.stringify({ title: 'x' }),
    )

    expect(result.isError).toBe(true)
    expect(result.proposal).toBeUndefined()
  })

  it('refuses a proposal tool the workspace has switched off', async () => {
    const kit = await toolkit({ mcp_draft: false })
    const result = await kit!.run('sheetbase__notebook_block__insert', '{}')
    expect(result).toEqual({
      text: 'That tool is not available.',
      isError: true,
    })
  })
})

describe('assistant toolkit lab tools', () => {
  it('can read the schedule and the lab, and book only when it may draft', async () => {
    const off = await toolkit({ mcp_draft: false })
    const on = await toolkit({ mcp_draft: true })
    const names = (kit: typeof on) => kit?.defs.map((def) => def.name) ?? []

    for (const kit of [off, on]) {
      expect(names(kit)).toContain('sheetbase__schedule__read')
      expect(names(kit)).toContain('sheetbase__schedule__free_time')
      expect(names(kit)).toContain('sheetbase__lab__list')
    }

    expect(names(off)).not.toContain('sheetbase__booking__create')
    expect(names(on)).toContain('sheetbase__booking__create')
    expect(names(on)).toContain('sheetbase__booking__move')
    expect(names(on)).toContain('sheetbase__booking__cancel')
    expect(off?.instructions).toContain('open the Schedule page')
  })

  it('tells the model to find things by name and never ask for ids', async () => {
    const kit = await toolkit({})
    expect(kit?.instructions).toContain('never ask the person for one')
    expect(kit?.instructions).toContain('never say Sheetbase cannot do it')
  })
})
