import { describe, expect, it } from 'vitest'

import {
  readCreated,
  readRecord,
  recordReadDefs,
  textOf,
} from './assistant-record-read.server'
import type { LabToolContext } from './assistant-lab-tools.server'
import { createDataClient } from './data-client'

const EXPERIMENT = {
  id: '11111111-1111-4111-8111-111111111111',
  identifier: 'EXP-4302',
  title: 'PicoGreen dsDNA assay optimisation',
  kind: 'experiment',
  status: 'draft',
  project_id: 'p1',
  properties: {},
  created_at: '2026-11-26T18:00:00Z',
  created_by_user_id: 'u',
  source_notebook_template_version_id: null,
}

function context(rows: Record<string, object[]>): LabToolContext {
  const client = createDataClient(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://app.test',
    )

    return Response.json(rows[url.pathname.replace('/api/db/', '')] ?? [])
  })

  return { client, workspaceId: 'w', userId: 'u', timeZone: 'UTC' }
}

describe('record read for the assistant', () => {
  it('is offered with both tools', () => {
    expect(recordReadDefs().map((def) => def.name)).toEqual([
      'sheetbase__record__read',
      'sheetbase__assistant__created',
    ])
  })

  it('collects the words of a block payload', () => {
    expect(
      textOf({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Mix 1 mL' }] },
        ],
      }),
    ).toEqual(['Mix 1 mL'])
  })

  it('shows milestones and says plainly when the notebook is empty', async () => {
    const result = await readRecord(
      { record: 'EXP-4302' },
      context({
        records: [EXPERIMENT],
        'rpc/record_parts': [
          {
            part_number: 1,
            title: 'Milestone 1',
            day_offset: 0,
            due_on: '2026-11-26',
            status: 'now',
            is_current: true,
            step_count: 0,
            steps_done: 0,
            block_count: 0,
            result_count: 0,
          },
        ],
      }),
    )

    const body = JSON.parse(result.text)

    expect(result.isError).toBe(false)
    expect(body.id).toBe('EXP-4302')
    expect(body.milestones).toHaveLength(1)
    expect(body.notebook).toMatch(/no content yet/)
  })

  it('reads notebook text when there is some', async () => {
    const result = await readRecord(
      { record: 'EXP-4302' },
      context({
        records: [EXPERIMENT],
        blocks: [
          {
            id: 'b',
            type: 'rich_text',
            order: 1,
            payload: { title: 'Method', doc: 'Add dye' },
          },
        ],
      }),
    )

    expect(JSON.parse(result.text).notebook[0].text).toContain('Add dye')
  })

  it('lists applied cards from saved chats', async () => {
    const result = await readCreated(
      {},
      context({
        assistant_conversations: [
          {
            title: 'PicoGreen',
            updated_at: '2026-11-26T18:00:00Z',
            messages: [
              {
                role: 'assistant',
                parts: [
                  {
                    output: {
                      ok: true,
                      outcome: {
                        status: 'applied',
                        title: 'PicoGreen experiment',
                        made: { identifier: 'EXP-4302', title: 'PicoGreen' },
                        at: '2026-11-26T18:01:00Z',
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    )

    expect(JSON.parse(result.text).cards[0]).toMatchObject({
      result: 'applied',
      made: 'EXP-4302 PicoGreen',
    })
  })
})
