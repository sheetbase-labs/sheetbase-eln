/**
 * A request that needs several changes, where a later change uses what an
 * earlier one makes ("create a project, then add a reagent to it"), run the way
 * a person runs it: the model proposes one plan card, the person presses
 * Apply, and the project and the reagent exist in the database, the reagent
 * inside the project.
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

describe('a plan of dependent changes', () => {
  it('creates a project, then a reagent inside it, from one card', async () => {
    world.newChat()
    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.plan.propose',
                arguments: {
                  title: 'Project and reagent',
                  summary: 'Create Vaccine B and add PBS to it',
                  steps: [
                    {
                      title: 'Create the project',
                      tool: 'sheetbase.project.create',
                      arguments: {
                        title: 'Create Vaccine B',
                        summary: 'A new project',
                        projectName: 'Vaccine B',
                      },
                    },
                    {
                      title: 'Add PBS',
                      tool: 'sheetbase.record.create',
                      arguments: {
                        title: 'Add PBS',
                        summary: 'A new reagent',
                        kind: 'material',
                        name: 'PBS 10x',
                        project: 'Vaccine B',
                      },
                    },
                  ],
                },
              },
            ],
          }
        : { text: 'I have prepared a plan for you to approve.' },
    )

    const turn = await world.ask(
      'Create a project called Vaccine B and add PBS 10x to it',
    )

    expect(turn.error).toBeUndefined()
    expect(turn.steps.map((step) => step.ok)).toEqual([true])
    expect(turn.cards).toHaveLength(1)

    const result = await world.apply(turn.cards[0])

    expect(result, JSON.stringify(result)).toMatchObject({ status: 'applied' })

    const rows = await world.sql<{ name: string; project: string }>(
      `SELECT r.title AS name, p.title AS project
         FROM api.records r JOIN api.projects p ON p.id = r.project_id
        WHERE r.workspace_id = $1 AND r.title = 'PBS 10x'`,
      [world.workspaceId],
    )

    expect(rows).toEqual([{ name: 'PBS 10x', project: 'Vaccine B' }])
  })
})
