/**
 * "Why" questions: "what is stopping EXP-12 being submitted", "why is DS-3
 * flagged", "what is holding up my work". The assistant answers each with one
 * read that gives what the record page shows, says dates the way the app does,
 * and a failed lookup tells the model how to put it right instead of reaching
 * the person.
 */
import { randomUUID } from 'node:crypto'
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

/** Reads one tool and hands its result back as the answer, so the test sees it. */
function readsOnce(name: string, args: Record<string, unknown>) {
  world.script((request) =>
    request.step === 0
      ? { calls: [{ name, arguments: args }] }
      : { text: request.toolResults[0]?.text ?? '' },
  )
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/

/**
 * An unfinished protocol step, as pinning a protocol would leave it.
 */
async function addStep(recordId: string, text: string) {
  // Triggers insist the step came from a pinned protocol revision; this test
  // only needs the row, so they are skipped for this one insert.
  await world.admin.query('begin')
  await world.admin.query('set local session_replication_role = replica')
  await world.admin.query(
    `insert into api.blocks(record_id, type, payload, "order", created_by_user_id)
     values ($1, 'procedure_step', $2::jsonb, 1, $3)`,
    [
      recordId,
      JSON.stringify({ text, stepNumber: 1, completed: false }),
      world.userId,
    ],
  )
  await world.admin.query('commit')
}

/** A dataset with one value its field's rule flags as out of range. */
async function flaggedDataset(name: string) {
  const field = randomUUID()
  const row = randomUUID()

  const definition = await world.rpc<{ schema_version_id: string }>(
    'create_dataset_schema_definition',
    {
      p_workspace_id: world.workspaceId,
      p_key: `titre_${field.slice(0, 8)}`,
      p_name: `${name} table`,
      p_description: null,
      p_fields: [
        {
          fieldId: field,
          key: 'titre',
          label: 'Titre',
          logicalType: 'decimal',
          nullable: true,
        },
      ],
    },
  )

  await world.rpc('publish_dataset_schema_version', {
    p_schema_version_id: definition.schema_version_id,
  })

  const [dataset] = await world.sql<{ id: string; display_id: string }>(
    `insert into api.datasets(workspace_id, schema_version_id, name, created_by_user_id)
     values ($1, $2, $3, $4) returning id, display_id`,
    [world.workspaceId, definition.schema_version_id, name, world.userId],
  )

  if (!dataset) throw new Error('No dataset was made.')

  const commit = await world.rpc<{ ok: boolean }>('commit_dataset_row_batch', {
    p_dataset_id: dataset.id,
    p_expected_dataset_revision: 1,
    p_rows: [{ operation: 'create', rowId: row, values: { [field]: 61.5 } }],
    p_idempotency_key: `why-${row}`,
  })

  expect(commit, JSON.stringify(commit)).toMatchObject({ ok: true })

  await world.rpc('flag_dataset_value', {
    p_dataset_id: dataset.id,
    p_row_id: row,
    p_field_id: field,
    p_kind: 'out_of_range',
    p_reason: 'Value 61.5 is above the maximum 50',
    p_comment: null,
  })

  return dataset
}

describe('what is stopping an experiment', () => {
  it('answers from the readiness the page shows, in one lookup', async () => {
    world.newChat()
    const project = await world.createProject('Why questions')
    const experiment = await world.createExperiment(project.id, 'Depth filter')

    await addStep(experiment.id, 'Load filter train B at 100 L/m²')
    await world.rpc('create_record_comment', {
      p_record_id: experiment.id,
      p_target_kind: 'record',
      p_target: {},
      p_body: 'Which lot of filter was used?',
      p_mentions: [],
    })

    readsOnce('sheetbase.blockers.read', { record: experiment.identifier })

    const turn = await world.ask(
      `What is stopping ${experiment.identifier} from being submitted for review?`,
    )

    expect(turn.steps, JSON.stringify(turn.steps)).toHaveLength(1)
    expect(turn.steps[0]).toMatchObject({ ok: true })

    const read = JSON.parse(turn.text) as {
      status: string
      answer: string
      canSubmit: boolean
      stopsSubmission: Array<{ what: string; detail?: string }>
      worthClearingFirst: Array<{ what: string }>
      nextStep: string | null
      stepsLeft: number
    }

    expect(read.status).toBe('Draft')
    expect(read.canSubmit).toBe(false)
    expect(read.answer).toContain(`stops ${experiment.identifier}`)
    expect(read.stopsSubmission.map((item) => item.what)).toContain(
      'Open comment thread',
    )
    expect(read.stopsSubmission[0]?.detail).toContain('Test Scientist')
    expect(read.nextStep).toBe('Step 1: Load filter train B at 100 L/m²')
    expect(read.stepsLeft).toBe(1)
    expect(turn.text).not.toMatch(ISO_DATE)
  })

  it('names the open flags on the experiment’s datasets', async () => {
    world.newChat()
    const project = await world.createProject('Flagged results')
    const experiment = await world.createExperiment(project.id, 'ELISA titre')
    const dataset = await flaggedDataset('ELISA capsid titre')

    await world.rpc('create_record_link', {
      p_source_record_id: experiment.id,
      p_target_kind: 'dataset',
      p_target_identifier: dataset.display_id,
      p_link_type: 'dataset',
      p_target_record_id: null,
      p_label: null,
    })

    readsOnce('sheetbase.blockers.read', { record: experiment.identifier })

    const turn = await world.ask(`Can I submit ${experiment.identifier}?`)
    const read = JSON.parse(turn.text) as {
      datasetFlags: Array<{
        dataset: string
        flags: Array<{ what: string; reason: string; raised: string }>
      }>
    }

    expect(read.datasetFlags).toEqual([
      expect.objectContaining({
        dataset: dataset.display_id,
        flags: [
          expect.objectContaining({
            what: 'Value outside its range',
            reason: 'Value 61.5 is above the maximum 50',
          }),
        ],
      }),
    ])
    expect(read.datasetFlags[0]?.flags[0]?.raised).toMatch(
      /^\d{1,2} [A-Z][a-z]{2} \d{4}$/,
    )
  })
})

describe('why a dataset is flagged', () => {
  it('reads the dataset’s open flags by its identifier', async () => {
    world.newChat()
    const dataset = await flaggedDataset('Turbidity')

    readsOnce('sheetbase.blockers.read', { record: dataset.display_id })

    const turn = await world.ask(`Why is ${dataset.display_id} flagged?`)
    const read = JSON.parse(turn.text) as {
      answer: string
      flags: Array<{ reason: string }>
    }

    expect(read.answer).toBe(`${dataset.display_id} has 1 open flag.`)
    expect(read.flags[0]?.reason).toBe('Value 61.5 is above the maximum 50')
  })

  it('finds the flags when the lab list is asked by dataset identifier', async () => {
    world.newChat()
    const dataset = await flaggedDataset('Capsid ratio')

    readsOnce('sheetbase.lab.list', {
      area: 'dataset_flags',
      query: dataset.display_id,
      openOnly: true,
    })

    const turn = await world.ask(`Does ${dataset.display_id} have open flags?`)
    const read = JSON.parse(turn.text) as {
      items: Array<{ reason: string; dataset: string }>
    }

    expect(read.items).toHaveLength(1)
    expect(read.items[0]?.dataset).toBe(`${dataset.display_id} Capsid ratio`)
  })
})

describe('what is holding up my work', () => {
  it('goes through the person’s own open experiments', async () => {
    world.newChat()
    const project = await world.createProject('My work')
    const experiment = await world.createExperiment(project.id, 'Mine to do')

    readsOnce('sheetbase.blockers.read', {})

    const turn = await world.ask('What is holding up my experiments?')
    const read = JSON.parse(turn.text) as {
      experiments: Array<{ experiment: string; answer: string }>
    }

    expect(read.experiments.map((row) => row.experiment)).toContain(
      `[${experiment.identifier}](/records/${experiment.identifier})`,
    )
  })
})

describe('a lookup that fails', () => {
  it('tells the model how to put it right, and the next call answers', async () => {
    world.newChat()
    const project = await world.createProject('Retry')
    const experiment = await world.createExperiment(project.id, 'Retry me')

    world.script((request) =>
      request.step === 0
        ? {
            calls: [
              {
                name: 'sheetbase.canonical.read',
                arguments: {
                  resource: 'review_submissions',
                  filters: { experiment_ref: experiment.identifier },
                },
              },
            ],
          }
        : request.step === 1
          ? {
              calls: [
                {
                  name: 'sheetbase.blockers.read',
                  arguments: { record: experiment.identifier },
                },
              ],
            }
          : { text: request.toolResults.at(-1)?.text ?? '' },
    )

    const turn = await world.ask(`Why can't I submit ${experiment.identifier}?`)

    expect(turn.steps.map((step) => step.ok)).toEqual([false, true])
    expect(turn.steps[0]?.error).toMatch(/Readable columns: .*record_id/)
    expect(turn.text).toContain('"canSubmit"')
  })
})
