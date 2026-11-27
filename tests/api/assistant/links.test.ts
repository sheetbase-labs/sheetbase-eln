/**
 * Questions about how records connect: "which experiments use this material?",
 * "what is this experiment linked to?". The assistant must answer with what
 * the record page shows (same readers), in one lookup, not a string of them.
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

describe('links the record pages show', () => {
  it('says which experiments use a material, in one lookup', async () => {
    world.newChat()
    const project = await world.createProject('Link reading')
    const experiment = await world.createExperiment(project.id, 'Buffer prep')

    const material = await world.rpc<{ id: string; identifier: string }>(
      'create_model_record',
      {
        p_project_id: project.id,
        p_kind: 'material',
        p_title: 'Tris buffer',
        p_status: 'available',
        p_tags: [],
        p_properties: {},
        p_custom_fields: {},
      },
    )

    await world.rpc('create_record_link', {
      p_source_record_id: experiment.id,
      p_target_kind: 'material',
      p_target_identifier: material.identifier,
      p_link_type: 'material',
      p_target_record_id: material.id,
      p_label: null,
    })

    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.record.read',
                arguments: { record: 'Tris buffer' },
              },
            ],
          }
        : { text: request.toolResults[0]?.text ?? '' },
    )

    const turn = await world.ask('Which experiments use Tris buffer?')

    expect(turn.steps, JSON.stringify(turn.steps)).toHaveLength(1)
    expect(turn.steps[0]).toMatchObject({ ok: true })
    expect(turn.text).toContain(experiment.identifier)

    const read = JSON.parse(turn.text) as {
      usedIn: Array<{ id: string }>
      linkedFrom: Array<{ id: string | null }>
    }

    expect(read.usedIn.map((row) => row.id)).toContain(experiment.identifier)
  })

  it('lists what an experiment is linked to when it is opened', async () => {
    world.newChat()
    const project = await world.createProject('Outgoing links')
    const experiment = await world.createExperiment(project.id, 'Assay run')

    const material = await world.rpc<{ id: string; identifier: string }>(
      'create_model_record',
      {
        p_project_id: project.id,
        p_kind: 'material',
        p_title: 'Sodium azide',
        p_status: 'available',
        p_tags: [],
        p_properties: {},
        p_custom_fields: {},
      },
    )

    await world.rpc('create_record_link', {
      p_source_record_id: experiment.id,
      p_target_kind: 'material',
      p_target_identifier: material.identifier,
      p_link_type: 'material',
      p_target_record_id: material.id,
      p_label: null,
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

    const turn = await world.ask(`What is ${experiment.identifier} linked to?`)

    expect(turn.steps).toHaveLength(1)
    expect(turn.text).toContain(material.identifier)
  })
})
