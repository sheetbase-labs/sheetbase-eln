/**
 * What the assistant can reach, checked the way a chat reaches it.
 *
 * - Every tool the assistant defines passes the gateway's allowlist. A tool
 *   missing from it fails the whole chat, not only that tool, so this offers the
 *   complete set to a real turn.
 * - For everyday requests, the tool that does the job is among the tools sent to
 *   the model. Each turn sends only a small selection; a request whose tool is
 *   not selected cannot be done at all.
 * - A card that adds a material, applied, leaves a material with its fields.
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

describe('the gateway allowlist', () => {
  it('accepts every tool the assistant defines in one turn', async () => {
    const [{ resolveAssistantRuntime }, { streamAssistant }] =
      await Promise.all([
        import('#/lib/assistant-actions'),
        import('#/lib/assistant'),
      ])

    const runtime = await resolveAssistantRuntime(
      world.workspaceId,
      new Headers(),
    )

    if (!runtime.ok || !runtime.deps.toolkit) throw new Error('No toolkit')
    const { toolkit } = runtime.deps

    world.script(() => ({ text: 'Offered everything.' }))

    // No selection: the whole set goes to the gateway at once.
    const started = await streamAssistant(
      {
        workspaceId: world.workspaceId,
        messages: [{ role: 'user', content: 'What can you do?' }],
        objectRefs: [],
      },
      {
        ...runtime.deps,
        toolkit: { ...toolkit, select: undefined },
      },
    )

    expect(started, JSON.stringify(started)).toMatchObject({ status: 'ok' })

    if (started.status === 'ok')
      for await (const event of started.events) void event

    const offered = world.model.requests.at(-1)?.toolNames ?? []

    expect(offered.length).toBe(toolkit.defs.length)

    // Two tools sharing a name make one of them unreachable: the model's call
    // lands on the other's schema and fails on keys it does not take.
    const names = toolkit.defs.map((def) => def.name)

    expect(
      names.filter((name, index) => names.indexOf(name) !== index),
    ).toEqual([])
    expect(offered.length).toBeGreaterThan(200)
  })
})

/** What a person would type, and the tool that has to be on offer for it. */
const INTENTS: Array<[request: string, tool: string]> = [
  ['Add a new material PBS 10x to the project', 'record__create'],
  ['Add a reagent called Trypsin with supplier Sigma', 'record__create'],
  ['Add a new lot of Tris buffer to stock', 'material__add_lot'],
  ['Create a project called Vaccine B', 'project__create'],
  [
    'Start an experiment from the stability template',
    'experiment__start_from_template',
  ],
  ['Book the plate reader tomorrow at 10', 'booking__create'],
  ['Log three samples in freezer A', 'sample__log'],
  ['Move sample SMP-0001 to box 2', 'sample__move'],
  ['Order more Tris buffer', 'reagent__order'],
  ['Invite a colleague to the workspace', 'member__invite'],
  ['Add an analysis to the notebook', 'analysis__add_to_notebook'],
  ['Add the plate to the experiment', 'plate__add_to_experiment'],
  ['Add a comment to EXP-0001', 'comment__add'],
  ['Archive the project', 'project__archive'],
  ['Restore the archived project', 'project__restore'],
  ['Link this sample to the experiment', 'record__link'],
  ['Archive this dataset', 'dataset__archive'],
  ['Duplicate this sheet', 'sheet__duplicate'],
  ['Add a milestone to the experiment', 'part__add'],
  ['Mark the milestone as complete', 'part__complete'],
  ['Assign this experiment to Ada', 'record__assign'],
  ['Mark the experiment as complete', 'experiment__set_status'],
  [
    'Write the text for each milestone in the notebook',
    'notebook_block__insert',
  ],
  ['Change the text of the first notebook block', 'notebook_block__update'],
  ['Add a storage location called Freezer 3', 'storage__add_location'],
  ['Send a request to the lab manager', 'request__send'],
  ['Report an incident, the centrifuge is broken', 'incident__report'],
  ['Add a new instrument', 'instrument__add'],
  ['Save an assistant note: I prefer metric units', 'ai_preference__save'],
  ['Undo that last change', 'changes__undo'],
]

describe('tool selection for everyday requests', () => {
  it.each(INTENTS)('"%s" offers %s', async (request, tool) => {
    world.newChat()
    world.script(() => ({ text: 'Understood.' }))
    await world.ask(request)

    expect(world.model.requests.at(-1)?.toolNames).toContain(
      `sheetbase__${tool}`,
    )
  })
})

describe('adding a material from a card', () => {
  it('leaves a material in the project with the fields that were asked for', async () => {
    world.newChat()
    const project = await world.createProject('Reagent room')

    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.record.create',
                arguments: {
                  title: 'Add Trypsin',
                  summary: 'A new reagent',
                  kind: 'material',
                  name: 'Trypsin 0.25%',
                  project: 'Reagent room',
                  fields: { Supplier: 'Sigma' },
                },
              },
            ],
          }
        : { text: 'Here is a card to add it.' },
    )

    const turn = await world.ask('Add Trypsin 0.25% from Sigma as a material')

    expect(turn.steps[0], JSON.stringify(turn.steps[0])).toMatchObject({
      ok: true,
    })
    expect(turn.cards).toHaveLength(1)
    expect(await world.apply(turn.cards[0])).toMatchObject({
      status: 'applied',
    })

    const rows = await world.sql<{
      kind: string
      project_id: string
      properties: Record<string, unknown>
    }>(
      `SELECT kind, project_id, properties FROM api.records
        WHERE workspace_id = $1 AND title = 'Trypsin 0.25%'`,
      [world.workspaceId],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'material', project_id: project.id })
    expect(JSON.stringify(rows[0].properties)).toContain('Sigma')
  })
})
