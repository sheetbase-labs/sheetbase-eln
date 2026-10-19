/**
 * Event trigger specs: the instrument filter and the input binding are
 * validated where every create and update passes, so a malformed value is
 * refused when the trigger is saved rather than when its first event arrives.
 */
import type { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prepareTestDatabase } from './helpers'

const INSTRUMENT = '00000000-0000-4000-8000-000000005120'

let migrator: Client

beforeAll(async () => {
  ;({ migrator } = await prepareTestDatabase())
})

afterAll(async () => {
  await migrator.end()
})

async function validate(spec: Record<string, unknown>) {
  const { rows } = await migrator.query<{ spec: Record<string, unknown> }>(
    `SELECT api.validate_pipeline_event_spec($1::jsonb) AS spec`,
    [JSON.stringify(spec)],
  )
  return rows[0]?.spec
}

describe('api.validate_pipeline_event_spec', () => {
  it('keeps an instrument filter and an input binding', async () => {
    const spec = await validate({
      eventType: 'dataset.versioned',
      instrumentId: INSTRUMENT,
      inputName: 'readings',
    })
    expect(spec).toMatchObject({
      eventType: 'dataset.versioned',
      instrumentId: INSTRUMENT,
      inputName: 'readings',
    })
  })

  it('treats missing and null as no filter and the default input', async () => {
    await expect(
      validate({ eventType: 'dataset.versioned' }),
    ).resolves.toBeDefined()
    await expect(
      validate({
        eventType: 'dataset.versioned',
        instrumentId: null,
        inputName: null,
      }),
    ).resolves.toBeDefined()
  })

  it('refuses an instrument filter that is not a uuid string', async () => {
    await expect(
      validate({
        eventType: 'dataset.versioned',
        instrumentId: 'plate-reader',
      }),
    ).rejects.toMatchObject({ code: 'SB034' })
    await expect(
      validate({ eventType: 'dataset.versioned', instrumentId: 7 }),
    ).rejects.toMatchObject({ code: 'SB034' })
  })

  it('refuses an input binding that is not a valid input identifier', async () => {
    for (const inputName of ['Readings', '9lives', 'has space', 5]) {
      await expect(
        validate({ eventType: 'dataset.versioned', inputName }),
      ).rejects.toMatchObject({ code: 'SB034' })
    }
  })
})
