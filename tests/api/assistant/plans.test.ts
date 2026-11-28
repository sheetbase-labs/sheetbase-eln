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

  it('creates a project, then starts experiments from a template into it', async () => {
    const templates = await world.createProject('Templates')

    await world.rpc('create_record', {
      p_project_id: templates.id,
      p_kind: 'protocol_template',
      p_title: 'ELISA standard',
      p_status: 'active',
      p_properties: { version: '1.0' },
    })

    world.newChat()
    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.plan.propose',
                arguments: {
                  title: 'Vaccine C and two ELISAs',
                  summary: 'Create Vaccine C, then start two ELISAs in it',
                  steps: [
                    {
                      title: 'Create the project',
                      tool: 'sheetbase.project.create',
                      arguments: {
                        title: 'Create Vaccine C',
                        summary: 'A new project',
                        projectName: 'Vaccine C',
                      },
                    },
                    {
                      title: 'Start experiment 1',
                      tool: 'sheetbase.experiment.start_from_template',
                      arguments: {
                        title: 'Start ELISA 1',
                        summary: 'From the ELISA template',
                        template: 'ELISA standard',
                        project: 'Vaccine C',
                        experimentTitle: 'ELISA run 1',
                      },
                    },
                    {
                      // The keys a model used for the tool that starts a
                      // draft: the plan must still start it from the template.
                      title: 'Start experiment 2',
                      tool: 'sheetbase.experiment.start',
                      arguments: {
                        title: 'Start ELISA 2',
                        summary: 'From the ELISA template',
                        template: 'ELISA standard',
                        project: 'Vaccine C',
                        experimentTitle: 'ELISA run 2',
                      },
                    },
                    {
                      // Other names for the same inputs.
                      title: 'Start experiment 3',
                      tool: 'sheetbase.experiment.start_from_template',
                      arguments: {
                        title: 'Start ELISA 3',
                        summary: 'From the ELISA template',
                        protocol: 'ELISA standard',
                        projectName: 'Vaccine C',
                        name: 'ELISA run 3',
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
      'Create project Vaccine C and start three ELISAs from the standard template',
    )

    expect(turn.error).toBeUndefined()
    expect(turn.cards).toHaveLength(1)

    const result = await world.apply(turn.cards[0])

    expect(result, JSON.stringify(result)).toMatchObject({
      status: 'applied',
    })

    const rows = await world.sql<{ title: string; project: string }>(
      `SELECT r.title, p.title AS project
         FROM api.records r JOIN api.projects p ON p.id = r.project_id
        WHERE r.workspace_id = $1 AND r.kind = 'experiment'
        ORDER BY r.title`,
      [world.workspaceId],
    )

    expect(rows).toEqual([
      { title: 'ELISA run 1', project: 'Vaccine C' },
      { title: 'ELISA run 2', project: 'Vaccine C' },
      { title: 'ELISA run 3', project: 'Vaccine C' },
    ])
  })

  describe('a notebook template made in the same plan', () => {
    const template = {
      title: 'Benzonase dose optimisation',
      summary: 'A dose-finding template',
      name: 'Benzonase dose optimisation',
      parts: [
        { title: 'Day 0 - Treat', dayOffset: 0 },
        { title: 'Day 1 - Verify', dayOffset: 1 },
      ],
      blocks: [
        {
          part: 'Day 0 - Treat',
          type: 'step',
          text: 'Aliquot the pool into 0, 25, 50 and 100 U/mL conditions.',
        },
        {
          part: 'Day 1 - Verify',
          type: 'step',
          text: 'Run the gel and quantify residual DNA.',
        },
      ],
    }

    const planOf = (publish: boolean) => ({
      title: 'Benzonase optimisation: template, project, experiment',
      summary: 'Make the template and project, then start run 1 in 10 mL lots',
      steps: [
        {
          title: 'Create the template',
          tool: 'sheetbase.template.create',
          arguments: template,
        },
        {
          title: 'Create the project',
          tool: 'sheetbase.project.create',
          arguments: {
            title: 'Create Benzonase optimisation',
            summary: 'A new project',
            projectName: 'Benzonase optimisation',
          },
        },
        ...(publish
          ? [
              {
                title: 'Publish the template',
                tool: 'sheetbase.template.publish',
                arguments: {
                  title: 'Publish Benzonase dose optimisation',
                  summary: 'So run 1 can start from it',
                  template: 'Benzonase dose optimisation',
                  reason: 'Ready for the first dose run',
                },
              },
            ]
          : []),
        {
          // The tool a model reached for in the conversation that failed: it
          // is the protocol-template tool, named with a notebook template.
          title: 'Start run 1 from the template',
          tool: 'sheetbase.experiment.start_from_template',
          arguments: {
            title: 'Start run 1',
            summary: 'From the new template',
            template: 'Benzonase dose optimisation',
            project: 'Benzonase optimisation',
            experimentTitle: 'Benzonase dose run 1',
          },
        },
      ],
    })

    const run = async (publish: boolean) => {
      world.newChat()
      world.script((request) =>
        request.step === 0
          ? {
              calls: [
                { name: 'sheetbase.plan.propose', arguments: planOf(publish) },
              ],
            }
          : { text: 'I have prepared a plan for you to approve.' },
      )

      const turn = await world.ask(
        'Set up a benzonase dose template, a project and run 1',
      )

      expect(turn.error).toBeUndefined()
      expect(turn.cards).toHaveLength(1)

      return world.apply(turn.cards[0])
    }

    it('starts the experiment from a published notebook template named in the start-from-template step', async () => {
      const result = await run(true)

      expect(result, JSON.stringify(result)).toMatchObject({
        status: 'applied',
      })

      const rows = await world.sql<{ title: string; project: string }>(
        `SELECT r.title, p.title AS project
           FROM api.records r JOIN api.projects p ON p.id = r.project_id
          WHERE r.workspace_id = $1 AND r.kind = 'experiment'
            AND r.title = 'Benzonase dose run 1'`,
        [world.workspaceId],
      )

      expect(rows).toEqual([
        { title: 'Benzonase dose run 1', project: 'Benzonase optimisation' },
      ])
    })

    it('says the template needs publishing, not that nothing matches', async () => {
      // The names are taken by the first test, so this plan only gets as far
      // as the lookups when they are new.
      const unpublished = planOf(false)

      for (const step of unpublished.steps) {
        const given = step.arguments as Record<string, unknown>

        for (const key of ['name', 'template', 'projectName', 'project']) {
          if (typeof given[key] === 'string')
            given[key] = `${given[key]} (draft only)`
        }

        if (typeof given['experimentTitle'] === 'string')
          given['experimentTitle'] = 'Benzonase draft-only run'
      }

      world.newChat()
      world.script((request) =>
        request.step === 0
          ? {
              calls: [
                { name: 'sheetbase.plan.propose', arguments: unpublished },
              ],
            }
          : { text: 'I have prepared a plan for you to approve.' },
      )

      const turn = await world.ask('Set up a draft-only benzonase template')
      const result = await world.apply(turn.cards[0])

      expect(result.status).toBe('failed')
      expect(result.reason ?? '').toMatch(/no published version/i)
      expect(result.reason ?? '').not.toMatch(/no record matches/i)
    })
  })

  it('keeps units in a card as written', async () => {
    world.newChat()
    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.plan.propose',
                arguments: {
                  title: 'Dose samples',
                  summary: 'Four 10 mL samples at 25 U/mL with 2 mM MgCl2',
                  steps: [
                    {
                      title: 'Create the project',
                      tool: 'sheetbase.project.create',
                      arguments: {
                        title: 'Create Units',
                        summary: 'A new project',
                        projectName: 'Units',
                      },
                    },
                  ],
                },
              },
            ],
          }
        : { text: 'Done.' },
    )

    const turn = await world.ask('Plan the dose samples')

    expect(turn.cards[0]?.proposal.summary).toBe(
      'Four 10 mL samples at 25 U/mL with 2 mM MgCl2',
    )
  })
})
