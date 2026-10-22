import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import {
  SheetbaseClient,
  PermissionDeniedError,
  NotFoundError,
  StaleVersionError,
  ValidationError,
  TokenError,
} from '@sheetbase/eln-sdk'

const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
const c = JSON.parse((await lines.next()).value)
const client = new SheetbaseClient(c)
const personal = new SheetbaseClient({ ...c, credential: c.personal })
const reader = new SheetbaseClient({
  ...c,
  credential: c.reader,
  scopes: ['projects:read'],
})
const pause = async (stage) => {
  console.log(stage)
  await lines.next()
}

const initial = await client.datasets.queryRows({ datasetId: c.dataset })
assert.equal(initial.totalCount, 0)
const rows = [
  { operation: 'create', rowId: randomUUID(), values: { [c.fieldId]: 37 } },
]
const key = randomUUID()
const first = await client.datasets.commitRows(
  c.dataset,
  initial.datasetRevision,
  rows,
  { idempotencyKey: key, retryOnStale: false },
)
const duplicate = await client.datasets.commitRows(
  c.dataset,
  initial.datasetRevision,
  rows,
  { idempotencyKey: key, retryOnStale: false },
)
assert.equal(duplicate.datasetRevision, first.datasetRevision)
assert.equal(
  (await client.datasets.queryRows({ datasetId: c.dataset })).totalCount,
  1,
)
const next = [
  { operation: 'create', rowId: randomUUID(), values: { [c.fieldId]: 83 } },
]
await assert.rejects(
  client.datasets.commitRows(c.dataset, initial.datasetRevision, next, {
    retryOnStale: false,
  }),
  StaleVersionError,
)
await client.datasets.commitRows(c.dataset, initial.datasetRevision, next)
// A row-level conflict must not be retried as a dataset-level conflict.
await assert.rejects(
  client.datasets.commitRows(c.dataset, first.datasetRevision + 1, [
    {
      operation: 'update',
      rowId: rows[0].rowId,
      expectedRevision: 99,
      values: { [c.fieldId]: 999 },
    },
  ]),
  ValidationError,
)
assert.equal(
  (await client.datasets.queryRows({ datasetId: c.dataset })).totalCount,
  2,
)
await assert.rejects(
  reader.datasets.queryRows({ datasetId: c.dataset }),
  PermissionDeniedError,
)
await assert.rejects(client.datasets.get(c.hiddenDataset), NotFoundError)
await assert.rejects(client.rpc('sign_record', {}), PermissionDeniedError)
assert.equal(
  (await personal.datasets.queryRows({ datasetId: c.dataset })).totalCount,
  2,
)

await pause('permissions')
assert.equal(
  (await personal.datasets.queryRows({ datasetId: c.dataset })).totalCount,
  2,
)
await assert.rejects(
  personal.datasets.commitRows(
    c.dataset,
    first.datasetRevision + 1,
    [
      {
        operation: 'create',
        rowId: randomUUID(),
        values: { [c.fieldId]: 999 },
      },
    ],
    { retryOnStale: false },
  ),
  PermissionDeniedError,
)
await pause('membership')
await assert.rejects(
  personal.datasets.queryRows({ datasetId: c.dataset }),
  PermissionDeniedError,
)
await pause('revocation')
// This client still has the JWT minted before revocation.
await assert.rejects(
  client.datasets.queryRows({ datasetId: c.dataset }),
  PermissionDeniedError,
)
const fresh = new SheetbaseClient(c)
await assert.rejects(
  fresh.datasets.queryRows({ datasetId: c.dataset }),
  (error) => error instanceof TokenError && error.code === 'revoked',
)
console.log('accepted')
process.exit(0)
