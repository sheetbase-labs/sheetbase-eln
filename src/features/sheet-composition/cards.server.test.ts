import { describe, expect, it } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  SHEET_ADOPT_LAYOUT_TOOL,
  SHEET_COMPOSITION_PROPOSE_TOOL_NAMES,
  SHEET_MATERIALIZE_TOOL,
} from './cards'
import {
  buildSheetCompositionProposal,
  sheetCompositionProposalDefs,
} from './cards.server'

const base = { title: 'T', summary: 'S' }

function routed(answer: (url: URL) => core.util.JSONType[]): LabToolContext {
  const fetchFixture: typeof fetch = async (input) =>
    Response.json(
      answer(
        input instanceof Request
          ? new URL(input.url)
          : new URL(input, 'http://x'),
      ),
    )

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const sheet = {
  id: 's1',
  name: 'Counts',
  display_id: 'SHT-0012',
  revision: 4,
  project_id: null,
  notebook_record_id: null,
  lifecycle: 'active',
  source_definition_version_id: 'v1',
}

describe('the sheet cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      sheetCompositionProposalDefs().map((def) =>
        def.name.replaceAll('__', '.'),
      ),
    ).toEqual([...SHEET_COMPOSITION_PROPOSE_TOOL_NAMES])

    for (const name of SHEET_COMPOSITION_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('saves a sheet as a dataset, found by its ID, at the revision it has now', async () => {
    const result = await buildSheetCompositionProposal(
      SHEET_MATERIALIZE_TOOL,
      { ...base, sheet: 'SHT-0012', name: ' Counts, 26 Nov ' },
      routed(() => [sheet]),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'sheet.materialize',
      instanceId: 's1',
      expectedRevision: 4,
      outputName: 'Counts, 26 Nov',
    })
  })

  it('moves a sheet to the newest published layout, and only when there is one', async () => {
    // The sheet's own version is asked for by id; the layout's versions by definition.
    const tables = (latest: number): LabToolContext => {
      const rows = (id: string, version: number) => ({
        id,
        definition_id: 'd1',
        version,
        lifecycle: 'published',
        revision: 1,
      })

      return routed((url) =>
        url.pathname.endsWith('sheet_instances')
          ? [sheet]
          : url.searchParams.has('id')
            ? [rows('v1', 1)]
            : [rows('v2', latest), rows('v1', 1)],
      )
    }

    const newer = await buildSheetCompositionProposal(
      SHEET_ADOPT_LAYOUT_TOOL,
      { ...base, sheet: 'Counts' },
      tables(2),
    )

    if (!newer.ok) throw new Error(newer.message)
    expect(newer.proposal.action).toMatchObject({
      kind: 'sheet.adopt_layout_version',
      targetDefinitionVersionId: 'v2',
    })

    const same = await buildSheetCompositionProposal(
      SHEET_ADOPT_LAYOUT_TOOL,
      { ...base, sheet: 'Counts' },
      tables(1),
    )

    expect(same.ok).toBe(false)
  })
})
