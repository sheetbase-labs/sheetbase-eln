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

    expect(result, JSON.stringify(result)).toMatchObject({
      status: 'applied',
    })

    const rows = await world.sql<{ name: string; project: string }>(
      `SELECT r.title AS name, p.title AS project
         FROM api.records r JOIN api.projects p ON p.id = r.project_id
        WHERE r.workspace_id = $1 AND r.title = 'PBS 10x'`,
      [world.workspaceId],
    )

    expect(rows).toEqual([{ name: 'PBS 10x', project: 'Vaccine B' }])
  })

  it('offers the plan tool for a request with two dependent changes', async () => {
    world.newChat()
    world.script(() => ({ text: 'On it.' }))
    await world.ask('Create a project called Zika and add a reagent to it')

    expect(world.model.requests.at(-1)?.toolNames).toContain(
      'sheetbase__plan__propose',
    )
  })

  it('refuses a lone card for a project that does not exist yet, and the plan then works', async () => {
    world.newChat()

    world.script((request) => {
      if (request.step === 0) {
        return {
          calls: [
            {
              name: 'sheetbase.record.create',
              arguments: {
                title: 'Add buffer',
                summary: 'A new reagent',
                kind: 'material',
                name: 'Buffer Z',
                project: 'Zika',
              },
            },
          ],
        }
      }

      // The model sees why the card could not be made and plans instead.
      if (request.step === 1) {
        return {
          calls: [
            {
              name: 'sheetbase.plan.propose',
              arguments: {
                title: 'Zika project and buffer',
                summary: 'Create Zika, then add Buffer Z',
                steps: [
                  {
                    title: 'Create Zika',
                    tool: 'sheetbase.project.create',
                    arguments: {
                      title: 'Create Zika',
                      summary: 'A new project',
                      projectName: 'Zika',
                    },
                  },
                  {
                    title: 'Add Buffer Z',
                    tool: 'sheetbase.record.create',
                    arguments: {
                      title: 'Add Buffer Z',
                      summary: 'A new reagent',
                      kind: 'material',
                      name: 'Buffer Z',
                      project: 'Zika',
                    },
                  },
                ],
              },
            },
          ],
        }
      }

      return { text: 'Planned.' }
    })

    const turn = await world.ask('Create a project Zika with a buffer in it')

    expect(turn.steps.map((step) => step.ok)).toEqual([false, true])
    expect(turn.cards.map((card) => card.tool)).toEqual([
      'sheetbase.plan.propose',
    ])

    expect(await world.apply(turn.cards[0])).toMatchObject({
      status: 'applied',
    })

    const rows = await world.sql<{ project: string }>(
      `SELECT p.title AS project FROM api.records r
         JOIN api.projects p ON p.id = r.project_id
        WHERE r.workspace_id = $1 AND r.title = 'Buffer Z'`,
      [world.workspaceId],
    )

    expect(rows).toEqual([{ project: 'Zika' }])
  })

  it('stops at the first step that fails and leaves nothing half-made after it', async () => {
    world.newChat()
    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.plan.propose',
                arguments: {
                  title: 'Two changes',
                  summary: 'Create Dengue, then add a reagent to Typo project',
                  steps: [
                    {
                      title: 'Create Dengue',
                      tool: 'sheetbase.project.create',
                      arguments: {
                        title: 'Create Dengue',
                        summary: 'A new project',
                        projectName: 'Dengue',
                      },
                    },
                    {
                      title: 'Add a reagent',
                      tool: 'sheetbase.record.create',
                      arguments: {
                        title: 'Add Reagent Q',
                        summary: 'A new reagent',
                        kind: 'material',
                        name: 'Reagent Q',
                        project: 'No such project anywhere',
                      },
                    },
                  ],
                },
              },
            ],
          }
        : { text: 'Planned.' },
    )

    const turn = await world.ask('Create Dengue and add Reagent Q to a project')
    const result = await world.apply(turn.cards[0])

    expect(result.status).toBe('failed')
    expect(result.reason).toBeTruthy()

    const made = await world.sql<{ title: string }>(
      `SELECT title FROM api.records WHERE workspace_id = $1 AND title = 'Reagent Q'`,
      [world.workspaceId],
    )

    expect(made).toEqual([])
  })
})
