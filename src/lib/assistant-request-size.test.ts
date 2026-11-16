import { describe, expect, it } from 'vitest'

import { defaultAiFeatureFlags } from './ai-feature-flags'
import { createAssistantToolkit } from './assistant-tools.server'
import { ASSISTANT_SENT_HISTORY_TURNS, trimHistory } from './assistant'
import { FIND_TOOLS_NAME } from './assistant-tool-select'
import type { ProviderToolDef } from './ai-providers/types'
import type { DataClient } from './data-client'

const WORKSPACE = '33333333-3333-4333-8333-333333333333'

async function kit() {
  const toolkit = await createAssistantToolkit({
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: the toolkit builds definitions and reads through `list` only.
    client: { list: () => Promise.resolve([]) } as unknown as DataClient,
    actor: { kind: 'user', id: 'u' },
    workspaceId: WORKSPACE,
    flags: { ...defaultAiFeatureFlags(), mcp_draft: true },
  })

  if (!toolkit?.select) throw new Error('The toolkit has no tool selection.')

  return { ...toolkit, select: toolkit.select }
}

/** Rough tokens: four characters each, as the gateway's own estimate. */
const tokens = (defs: ProviderToolDef[]) =>
  Math.ceil(JSON.stringify(defs).length / 4)

describe('assistant request size', () => {
  it('sends a small slice of the tools, not all of them', async () => {
    const toolkit = await kit()
    const all = tokens(toolkit.defs)
    const sent = tokens(toolkit.select('Book the plate reader tomorrow at 10'))

    expect(toolkit.defs.length).toBeGreaterThan(150)
    expect(sent).toBeLessThan(all / 5)
    expect(sent).toBeLessThan(10_000)
  })

  it('sends only the core tools for a question that names no subject', async () => {
    const toolkit = await kit()
    const names = toolkit.select('hello').map((def) => def.name)

    expect(names).toContain(FIND_TOOLS_NAME)
    expect(names.length).toBeLessThan(12)
  })

  it('offers the tools a question is about', async () => {
    const toolkit = await kit()

    const names = toolkit
      .select('Move sample S-12 to freezer 3')
      .map((def) => def.name)

    expect(names.some((name) => name.startsWith('sheetbase__sample__'))).toBe(
      true,
    )
  })

  it('adds tools the model asks for and keeps the ones it used', async () => {
    const toolkit = await kit()
    const before = toolkit.select('hello').map((def) => def.name)
    expect(before).not.toContain('sheetbase__booking__create')

    const found = await toolkit.run(
      FIND_TOOLS_NAME,
      JSON.stringify({ query: 'book an instrument' }),
    )

    expect(found.isError).toBe(false)

    expect(toolkit.select('hello').map((def) => def.name)).toContain(
      'sheetbase__booking__create',
    )
  })

  it('keeps the instructions small and the clock last, so they can be reused', async () => {
    const toolkit = await kit()

    expect(toolkit.instructions.length).toBeLessThan(10_500)
    expect(toolkit.instructions.trimEnd().split('\n\n').at(-1)).toContain(
      'on the person’s clock',
    )
  })

  it('sends only recent history, older turns shortened', () => {
    const turns = Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: 'x'.repeat(3_000),
    }))

    const sent = trimHistory(turns)

    expect(sent.length).toBeLessThanOrEqual(ASSISTANT_SENT_HISTORY_TURNS)
    expect(sent.reduce((n, turn) => n + turn.content.length, 0)).toBeLessThan(
      14_000,
    )
  })
})
