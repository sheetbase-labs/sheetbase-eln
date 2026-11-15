import { describe, expect, it, vi } from 'vitest'

import { z } from 'zod'

import type { AiFeatureFlags } from '../ai-feature-flags'
import type { Scope } from '../api-credential-scopes'
import type { DataClient } from '../data-client'
import { handleMcpMessage } from './handler'
import {
  listTemplates,
  lotsOnHand,
  protocolContent,
  readProtocols,
  readStock,
  runLookup,
} from './lookups'
import { testClient } from './test-transport'

const FLAGS: AiFeatureFlags = {
  assistant: true,
  mcp_read: true,
  mcp_draft: true,
  mcp_workflow: true,
  mcp_admin_read: true,
  mcp_admin_propose: true,
  mcp_lab: true,
}

const PROTOCOL = '11111111-1111-4111-8111-111111111111'

function clientWith(rows: { [resource: string]: object[] }) {
  const list = vi
    .fn<DataClient['list']>()
    .mockImplementation(async (resource) => rows[resource] ?? [])

  return { client: testClient({ list }), list }
}

describe('protocolContent', () => {
  it('orders the steps and flattens the prose', () => {
    const content = protocolContent([
      { type: 'procedure_step', payload: { text: 'Read', stepNumber: 2 } },
      { type: 'procedure_step', payload: { text: 'Dilute', stepNumber: 1 } },
      {
        type: 'rich_text',
        payload: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Purpose' }],
              },
            ],
          },
        },
      },
    ])

    expect(content.steps.map((step) => step.text)).toEqual(['Dilute', 'Read'])
    expect(content.text).toEqual(['Purpose'])
  })
})

describe('readProtocols', () => {
  it('finds a protocol by name and reads its steps, versions and links', async () => {
    const { client, list } = clientWith({
      records: [
        {
          id: PROTOCOL,
          kind: 'protocol_template',
          identifier: 'PRT-1',
          title: 'PicoGreen assay',
          status: 'active',
        },
      ],
      blocks: [
        {
          type: 'procedure_step',
          payload: { text: 'Dilute dye', stepNumber: 1 },
        },
      ],
      protocol_versions: [
        {
          version: 2,
          status: 'effective',
          effective_at: null,
          review_due_at: null,
        },
      ],
      record_links: [
        {
          target_kind: 'material',
          target_identifier: 'MAT-9',
          link_type: 'uses',
        },
      ],
    })

    const found = await readProtocols({ query: 'PicoGreen' }, client)

    expect(found.protocols).toHaveLength(1)

    expect(found.protocols[0]).toMatchObject({
      identifier: 'PRT-1',
      steps: [{ number: 1, text: 'Dilute dye' }],
      versions: [{ version: 2 }],
      linkedRecords: [{ identifier: 'MAT-9', kind: 'material' }],
    })

    expect(list.mock.calls[0][1]).toContain('ilike.')
    expect(list.mock.calls[0][1]).toContain('PicoGreen')
  })

  it('keeps list characters in the words out of the filter', async () => {
    const { client, list } = clientWith({})

    await readProtocols({ query: 'a),id.eq.1(b' }, client)

    expect(decodeURIComponent(list.mock.calls[0][1] ?? '')).not.toContain(
      '),id',
    )
  })

  it('says so when nothing matches', async () => {
    const { client } = clientWith({})
    const found = await readProtocols({ query: 'nope' }, client)

    expect(found.protocols).toEqual([])
    expect(found.note).toMatch(/do not invent/)
  })
})

describe('stock', () => {
  const movement = (lot: string, left: number, at: string) => ({
    reagent_record_id: 'r1',
    lot,
    resulting_quantity: left,
    unit: 'mL',
    expiry: null,
    supplier: 'S',
    catalog_no: 'C1',
    created_at: at,
  })

  it('takes the latest movement of each lot as what is left', () => {
    const lots = lotsOnHand([
      movement('A', 10, '2026-01-01'),
      movement('A', 4, '2026-02-01'),
      movement('B', 7, '2026-01-15'),
    ])

    expect(lots.find((lot) => lot.lot === 'A')?.quantityLeft).toBe(4)
    expect(lots).toHaveLength(2)
  })

  it('reports lots for matching reagents and leaves out records without stock', async () => {
    const { client } = clientWith({
      records: [
        {
          id: 'r1',
          kind: 'material',
          identifier: 'MAT-1',
          title: 'PicoGreen dye',
          status: null,
        },
        {
          id: 'r2',
          kind: 'sample',
          identifier: 'SMP-1',
          title: 'PicoGreen plate',
          status: null,
        },
      ],
      reagent_movements: [movement('A', 4, '2026-02-01')],
    })

    const stock = await readStock({ query: 'PicoGreen' }, client)

    expect(stock.items).toHaveLength(1)
    expect(stock.items[0]).toMatchObject({ identifier: 'MAT-1' })
  })
})

describe('templates and models', () => {
  it('lists models, and templates only with the templates scope', async () => {
    const { client } = clientWith({
      record_models: [
        {
          id: 'm1',
          key: 'sample',
          name: 'Sample',
          description: null,
          identifier_prefix: 'SMP',
          lifecycle: 'active',
          current_version: 3,
        },
      ],
      notebook_templates: [
        {
          id: 't1',
          key: 'pg',
          name: 'PicoGreen',
          description: null,
          lifecycle: 'published',
          display_id: 'TPL-1',
        },
      ],
      notebook_template_versions: [
        { template_id: 't1', version: 2, lifecycle: 'published' },
      ],
    })

    const withTemplates = await listTemplates({}, client, { templates: true })

    expect(withTemplates.templates).toMatchObject([
      { name: 'PicoGreen', latestVersion: { version: 2 } },
    ])
    expect(withTemplates.models).toHaveLength(1)

    const without = await listTemplates({}, client, { templates: false })

    expect(without.templates).toEqual([])
  })

  it('refuses arguments that do not match', async () => {
    const { client } = clientWith({})

    const result = await runLookup(
      'sheetbase.protocol.read',
      {},
      {
        client,
        grants: { templates: false },
      },
    )

    expect(result.isError).toBe(true)
  })
})

describe('over MCP', () => {
  async function names(scopes: Scope[], flags = FLAGS) {
    const response = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      {
        workspaceId: '44444444-4444-4444-8444-444444444444',
        actor: { kind: 'user', id: 'user-1' },
        scopes,
        flags,
        client: clientWith({}).client,
        credentialId: 'credential-1',
      },
    )

    return z
      .object({
        result: z.object({ tools: z.array(z.object({ name: z.string() })) }),
      })
      .parse(response)
      .result.tools.map((tool) => tool.name)
  }

  it('lists the three lookups with read access and not without', async () => {
    expect(await names(['projects:read'])).toEqual(
      expect.arrayContaining([
        'sheetbase.protocol.read',
        'sheetbase.stock.read',
        'sheetbase.template.list',
      ]),
    )

    expect(await names(['datasets:read'])).not.toContain(
      'sheetbase.protocol.read',
    )

    expect(
      await names(['projects:read'], { ...FLAGS, mcp_read: false }),
    ).not.toContain('sheetbase.stock.read')
  })
})
