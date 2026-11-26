/**
 * A chat that goes on after a card was applied: the assistant must be told what
 * the card came to, and must be able to open what it made, by the ID the app
 * shows, and read the notebook text inside it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { startWorld } from './world'
import type { World } from './world'

vi.mock('#/lib/auth', async (importOriginal) => {
  const { authMock } = await import('./auth-mock')

  return authMock(await importOriginal())
})

let world: World

beforeAll(async () => {
  world = await startWorld()
})

afterAll(async () => {
  await world?.stop()
})

describe('follow-up questions about earlier results', () => {
  it('tells the assistant a card was applied and lets it read what was made', async () => {
    world.newChat()
    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.project.create',
                arguments: {
                  title: 'Create the Mpox project',
                  summary: 'A new project',
                  projectName: 'Mpox serology',
                },
              },
            ],
          }
        : { text: 'Here is a card to create the project.' },
    )

    const first = await world.ask('Create a project called Mpox serology')

    expect(first.cards).toHaveLength(1)
    expect(await world.apply(first.cards[0])).toMatchObject({
      status: 'applied',
    })

    // The next question: the assistant opens it by name, then by the ID the app shows.
    world.script((request) => {
      if (request.step === 0) {
        return {
          calls: [
            {
              name: 'sheetbase.record.read',
              arguments: { record: 'Mpox serology' },
            },
          ],
        }
      }

      return {
        text: `It exists: ${request.toolResults[0]?.text.slice(0, 200)}`,
      }
    })

    const second = await world.ask('What did you just make?')
    const sent = world.model.requests.at(-2)

    expect(
      sent?.messages.map((message) => JSON.stringify(message)).join('\n'),
    ).toContain('APPLIED')

    expect(second.steps, JSON.stringify(second.steps)).toHaveLength(1)
    expect(second.steps[0].error).toBeUndefined()
    expect(second.steps[0]).toMatchObject({
      name: 'sheetbase.record.read',
      ok: true,
    })
    expect(second.text).toContain('Mpox serology')

    const [project] = await world.sql<{ display_id: string }>(
      `SELECT display_id FROM api.projects WHERE workspace_id = $1 AND title = 'Mpox serology'`,
      [world.workspaceId],
    )

    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.record.read',
                arguments: { record: project.display_id },
              },
            ],
          }
        : { text: request.toolResults[0]?.text ?? '' },
    )

    const third = await world.ask(`Open ${project.display_id}`)

    expect(third.steps[0]).toMatchObject({ ok: true })
    expect(third.text).toContain('Mpox serology')
  })

  it('reads the text inside an experiment notebook', async () => {
    world.newChat()
    const project = await world.createProject('Notebook reading')
    const experiment = await world.createExperiment(project.id, 'Titre check')

    await world.rpc('insert_block', {
      p_record_id: experiment.id,
      p_type: 'rich_text',
      p_payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Incubate for 48 hours at 37C.' },
              ],
            },
          ],
        },
      },
    })

    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.record.read',
                arguments: { record: experiment.identifier },
              },
            ],
          }
        : { text: request.toolResults[0]?.text ?? '' },
    )

    const turn = await world.ask(`What does ${experiment.identifier} say?`)

    expect(turn.steps[0]).toMatchObject({ ok: true })
    expect(turn.text).toContain('Incubate for 48 hours at 37C.')
  })
})
