/**
 * Several cards for one notebook, applied one after another the way a person
 * works down a list ("write the text for each milestone"). Every card is built
 * before the first is applied, so each must still apply after the ones before
 * it changed the notebook, and every block must end up with its text.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { startWorld } from './world'
import type { World } from './world'

vi.mock('#/lib/auth', async (importOriginal) => {
  const { authMock } = await import('./auth-mock')

  return authMock(await importOriginal())
})

let world: World
let experiment: { id: string; identifier: string }

beforeAll(async () => {
  world = await startWorld()
  const project = await world.createProject('Stability programme')
  experiment = await world.createExperiment(project.id, 'Stability at 4C')
})

afterAll(async () => {
  await world?.stop()
})

const MILESTONES = [
  'Milestone 1: prepare the buffers and filter them.',
  'Milestone 2: load the samples onto the plate.',
  'Milestone 3: read the plate and export the results.',
]

describe('several notebook text cards in a row', () => {
  it('applies every card, not only the first', async () => {
    world.newChat()
    world.script((request) =>
      request.step === 0
        ? {
            calls: MILESTONES.map((text, index) => ({
              name: 'sheetbase.notebook_block.insert',
              arguments: {
                title: `Text for milestone ${index + 1}`,
                summary: 'Write what the milestone involves',
                recordId: experiment.id,
                text,
              },
            })),
          }
        : { text: 'Here is the text for each milestone.' },
    )

    const turn = await world.ask('Write the text for each milestone')

    expect(turn.steps.every((step) => step.ok)).toBe(true)
    expect(turn.cards).toHaveLength(3)

    const results = []

    for (const card of turn.cards) results.push(await world.apply(card))

    expect(results.map((result) => result.status)).toEqual([
      'applied',
      'applied',
      'applied',
    ])

    const notebook = (await world.notebookText(experiment.id)).join('\n')

    for (const text of MILESTONES) expect(notebook).toContain(text)
  })
})
