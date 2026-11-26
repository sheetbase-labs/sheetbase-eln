import { describe, expect, it } from 'vitest'

import { createDataClient } from '#/lib/data-client'

import type { DatasetCardsAction } from './cards'
import { runDatasetCardsAction } from './cards-run'

const client = createDataClient(async () => Response.json({}))

const action: DatasetCardsAction = {
  kind: 'sheetbase.dataset.import_file',
  rpc: 'commit_dataset_import',
  openHref: '/datasets/ds1',
  args: {
    fileId: 'f1',
    datasetId: 'ds1',
    mapping: { sources: [{ source: 'Sample', fieldId: 'x', unit: null }] },
    sheetName: null,
    idempotencyKey: 'k1',
  },
}

describe('running the import card', () => {
  it('sends a kept file to the app’s import and opens the dataset', async () => {
    const sent: unknown[] = []

    await expect(
      runDatasetCardsAction(client, action, async (input) => {
        sent.push(input)

        return { ok: true, committed: 4, errors: [] }
      }),
    ).resolves.toEqual({
      openHref: '/datasets/ds1',
    })

    expect(sent).toEqual([action.args])
  })

  it('shows why the import was refused', async () => {
    await expect(
      runDatasetCardsAction(client, action, async () => ({
        ok: false,
        committed: 0,
        errors: [
          { code: 'commit_failed', message: 'A data contract refused it.' },
        ],
      })),
    ).rejects.toThrow('A data contract refused it.')
  })
})
