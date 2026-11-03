import { describe, expect, it } from 'vitest'

import type { DataClient } from './data-client'
import { plainTextToRichText } from './blocks/plain-text'
import { buildAssistantProposal } from './assistant-proposals.server'
import { proposalToolDefs } from './assistant-proposals'

const RECORD = '11111111-1111-4111-8111-111111111111'
const BLOCK = '22222222-2222-4222-8222-222222222222'
const WORKSPACE = '33333333-3333-4333-8333-333333333333'

const recordRow = {
  id: RECORD,
  workspace_id: WORKSPACE,
  project_id: null,
  folder_id: null,
  kind: 'experiment',
  identifier: 'EXP-12',
  title: 'Buffer screen',
  status: 'draft',
  tags: [],
  structure_version: 7,
  metadata_version: 4,
  created_at: '',
  updated_at: '',
  archived_at: null,
  deleted_at: null,
  created_by_user_id: 'u',
  updated_by_user_id: null,
  properties: {},
  custom_fields: { organism: 'E. coli' },
  locked_at: null,
  locked_by_revision_id: null,
}

function client(): DataClient {
  return {
    list: (resource: string) => {
      if (resource === 'records') return Promise.resolve([recordRow])
      if (resource === 'blocks')
        return Promise.resolve([
          {
            id: BLOCK,
            record_id: RECORD,
            type: 'rich_text',
            payload: plainTextToRichText('Old aim'),
            payload_schema_version: 1,
            order: 1,
            version: 3,
          },
        ])
      return Promise.resolve([])
    },
  } as unknown as DataClient
}

describe('buildAssistantProposal', () => {
  it('builds an insert against the record’s current structure version', async () => {
    const built = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.notebook_block.insert',
      {
        title: 'Add aim',
        summary: 'Adds the aim.',
        recordId: RECORD,
        text: 'Test the buffer.',
      },
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.proposal.operation).toMatchObject({
      kind: 'notebook_block.insert',
      recordId: RECORD,
      expectedRevision: 7,
    })
    expect(built.proposal.target).toBe('EXP-12 · Buffer screen')
    expect(built.proposal.changes[0]?.before).toBeNull()
  })

  it('shows the old and new text for a block update with its version', async () => {
    const built = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.notebook_block.update',
      {
        title: 'Reword aim',
        summary: 'Clearer aim.',
        blockId: BLOCK,
        text: 'New aim',
      },
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.proposal.changes[0]).toMatchObject({
      before: 'Old aim',
      after: 'New aim',
    })
    expect(built.proposal.operation).toMatchObject({
      kind: 'notebook_block.update',
      expectedVersion: 3,
    })
  })

  it('shows the old value for a field change', async () => {
    const built = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.record.custom_fields.update',
      {
        title: 'Set organism',
        summary: 'Fix the organism.',
        recordId: RECORD,
        values: { organism: 'B. subtilis' },
      },
    )
    expect(built.ok && built.proposal.changes[0]).toMatchObject({
      label: 'organism',
      before: 'E. coli',
      after: 'B. subtilis',
    })
    expect(built.ok && built.proposal.operation).toMatchObject({
      expectedMetadataVersion: 4,
    })
  })

  it('refuses bad arguments and unknown tools with a message', async () => {
    const bad = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.notebook_block.insert',
      {
        title: 'x',
        summary: 'y',
        recordId: 'not-a-uuid',
        text: 'z',
      },
    )
    expect(bad.ok).toBe(false)
    const unknown = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.signature.sign',
      {},
    )
    expect(unknown).toEqual({
      ok: false,
      message: 'That tool is not available.',
    })
  })

  it('offers the four tools to the model', () => {
    expect(proposalToolDefs().map((def) => def.name)).toEqual([
      'sheetbase__notebook_block__insert',
      'sheetbase__notebook_block__update',
      'sheetbase__record__custom_fields__update',
      'sheetbase__sheet_instance__update',
    ])
  })
})
