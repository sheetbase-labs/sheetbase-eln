import { describe, expect, it } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  TEMPLATE_UPGRADE_TOOL,
  TEMPLATE_USE_TOOL,
  TEMPLATE_VERSIONS_PROPOSE_TOOL_NAMES,
} from './cards'
import {
  buildTemplateVersionsProposal,
  templateVersionsProposalDefs,
} from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

/** Answers each table by name; a table may answer by the request instead. */
function routed(answer: (url: URL) => core.util.JSONType[]): LabToolContext {
  const fetchFixture: typeof fetch = async (input) =>
    Response.json(answer(urlOf(input)))

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

function context(tables: Record<string, core.util.JSONType[]>): LabToolContext {
  return routed((url) => tables[url.pathname.split('/').at(-1) ?? ''] ?? [])
}

const template = {
  id: 't1',
  name: 'Western blot',
  key: 'wb',
  display_id: 'TPL-0004',
}

const project = {
  id: 'p1',
  key: 'ASSAY',
  title: 'Assay',
  display_id: 'PRJ-0008',
}

describe('the template version cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      templateVersionsProposalDefs().map((def) =>
        def.name.replaceAll('__', '.'),
      ),
    ).toEqual([...TEMPLATE_VERSIONS_PROPOSE_TOOL_NAMES])

    for (const name of TEMPLATE_VERSIONS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('starts a notebook from the newest published version, found by the template ID', async () => {
    const result = await buildTemplateVersionsProposal(
      TEMPLATE_USE_TOOL,
      { ...base, template: 'TPL-0004', project: 'PRJ-0008' },
      context({
        notebook_templates: [template],
        projects: [project],
        notebook_template_versions: [
          {
            id: 'v3',
            template_id: 't1',
            version: 3,
            configuration: { parameters: [] },
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'template.use',
      versionId: 'v3',
      projectId: 'p1',
    })
  })

  it('sends the person to the app when the template asks for inputs', async () => {
    const result = await buildTemplateVersionsProposal(
      TEMPLATE_USE_TOOL,
      { ...base, template: 'Western blot', project: 'Assay' },
      context({
        notebook_templates: [template],
        projects: [project],
        notebook_template_versions: [
          {
            id: 'v3',
            template_id: 't1',
            version: 3,
            configuration: { parameters: [{ required: true }] },
          },
        ],
      }),
    )

    expect(result.ok).toBe(false)
  })

  it('updates a notebook to a newer version, but not a signed one', async () => {
    const notebook = {
      id: 'r1',
      identifier: 'EXP-0042',
      title: 'Blot',
      locked_at: null,
      source_notebook_template_version_id: 'v1',
    }

    // The notebook's own version is asked for by id; the newest by template.
    const answer =
      (records: core.util.JSONType[]) =>
      (url: URL): core.util.JSONType[] => {
        const table = url.pathname.split('/').at(-1)

        if (table === 'records') return records

        return url.searchParams.has('id')
          ? [{ template_id: 't1', version: 1 }]
          : [{ id: 'v2', template_id: 't1', version: 2, configuration: {} }]
      }

    const upgraded = await buildTemplateVersionsProposal(
      TEMPLATE_UPGRADE_TOOL,
      { ...base, notebook: 'EXP-0042' },
      routed(answer([notebook])),
    )

    if (!upgraded.ok) throw new Error(upgraded.message)
    expect(upgraded.proposal.action).toEqual({
      kind: 'template.upgrade_notebook',
      recordId: 'r1',
      targetVersionId: 'v2',
    })

    const signed = await buildTemplateVersionsProposal(
      TEMPLATE_UPGRADE_TOOL,
      { ...base, notebook: 'EXP-0042' },
      routed(answer([{ ...notebook, locked_at: '2026-11-01T00:00:00Z' }])),
    )

    expect(signed.ok).toBe(false)
  })
})
