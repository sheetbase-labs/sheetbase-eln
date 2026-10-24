// @vitest-environment node
import { createHash } from 'node:crypto'
import { appendFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { syncDatasetSnapshots } from './sync-dataset-snapshots'

const workspace = '10000000-0000-4000-8000-000000000001'
const dataset = '20000000-0000-4000-8000-000000000001'
const unavailableVersion = '30000000-0000-4000-8000-000000000000'
const version = '30000000-0000-4000-8000-000000000001'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('publishes complete exact snapshots atomically and reconciles idempotently after a failed page', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sheetbase-snapshot-sync-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const metadataJson = JSON.stringify({
    workspaceId: workspace,
    datasetId: dataset,
    datasetVersionId: version,
    totalCount: '1001',
    schema: [{ fieldId: 'amount', logicalType: 'decimal' }],
  })
  const metadataChecksum = hash(metadataJson)
  const rows = Array.from({ length: 1001 }, (_, index) => {
    const rowId = `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    const canonicalJson = JSON.stringify({
      rowId,
      revision: '9007199254740993',
      values: {
        amount: ['12345678901234567890.123456789', '0.00000000000000001'],
      },
      flags: [],
    })
    return { rowId, canonicalJson, sha256: hash(canonicalJson) }
  })
  const snapshotChecksum = hash(
    `${metadataChecksum}\n${rows.map((row) => `${row.sha256}\n`).join('')}`,
  )
  let fault = 'page'
  let transfers = 0
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/api/token') {
      response.end(JSON.stringify({ token: 'test-token' }))
      return
    }
    expect(request.headers.authorization).toBe('Bearer test-token')
    if (request.url?.startsWith('/api/db/dataset_versions?')) {
      response.end(
        JSON.stringify(
          request.url.includes('id=gt.')
            ? []
            : [unavailableVersion, version].map((id) => ({
                id,
                dataset_id: dataset,
                workspace_id: workspace,
              })),
        ),
      )
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const {
      p_dataset_version_id: requestedVersion,
      p_offset: offset,
      p_limit: limit,
    } = JSON.parse(Buffer.concat(chunks).toString())
    if (requestedVersion === unavailableVersion) {
      response.writeHead(400)
      response.end(
        JSON.stringify({
          error: {
            category: 'validation_error',
            message: 'Dataset Version rows were removed by retention',
            request_id: 'retention-test',
          },
        }),
      )
      return
    }
    transfers += 1
    const pageRows = rows.slice(offset, offset + limit)
    if (offset > 0 && fault === 'permission') {
      response.writeHead(403)
      response.end(
        JSON.stringify({
          error: {
            code: 'permission_denied',
            message: 'Access revoked',
            category: 'permission_denied',
          },
        }),
      )
      return
    }
    if (offset > 0 && fault === 'order') pageRows[0] = rows[0]
    if (offset > 0 && fault === 'row') {
      pageRows[0] = {
        ...pageRows[0],
        canonicalJson: pageRows[0].canonicalJson.replace(
          '12345678901234567890',
          '22345678901234567890',
        ),
      }
    }
    response.end(
      JSON.stringify({
        format: 'sheetbase.dataset-version-transfer/1',
        metadataJson,
        metadataChecksum,
        offset,
        limit,
        totalCount: rows.length,
        hasMore: offset + pageRows.length < rows.length,
        rows: pageRows,
        pageChecksum:
          fault === 'page' && offset > 0
            ? '0'.repeat(64)
            : hash(
                `${metadataChecksum}\n${pageRows.map((row) => `${row.sha256}\n`).join('')}`,
              ),
        snapshotChecksum:
          offset + pageRows.length === rows.length
            ? fault === 'snapshot'
              ? '0'.repeat(64)
              : snapshotChecksum
            : null,
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  )
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('No test listener')
  const options = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    credential: 'fixture',
    workspaceId: workspace,
    outputDirectory: dir,
  }
  for (const [failure, expected] of [
    ['page', /checksum/i],
    ['row', /checksum/i],
    ['snapshot', /checksum/i],
    ['order', /order/i],
    ['permission', /revoked/i],
  ] as const) {
    fault = failure
    await expect(syncDatasetSnapshots(options)).rejects.toThrow(expected)
    expect(await readdir(join(dir, workspace, dataset))).toEqual([])
  }
  fault = 'none'
  expect(await syncDatasetSnapshots(options)).toEqual({
    published: 1,
    existing: 0,
    unavailable: [unavailableVersion],
  })
  expect(await readdir(join(dir, workspace, dataset))).toEqual([version])
  const published = join(dir, workspace, dataset, version)
  const savedRows = (await readFile(join(published, 'rows.ndjson'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(savedRows).toHaveLength(1001)
  expect(savedRows[1000].revision).toBe('9007199254740993')
  expect(savedRows[1000].values.amount).toEqual([
    '12345678901234567890.123456789',
    '0.00000000000000001',
  ])
  expect(
    JSON.parse(await readFile(join(published, 'manifest.json'), 'utf8'))
      .snapshotChecksum,
  ).toBe(snapshotChecksum)
  const before = transfers
  expect(await syncDatasetSnapshots(options)).toEqual({
    published: 0,
    existing: 1,
    unavailable: [unavailableVersion],
  })
  expect(transfers).toBe(before)
  await appendFile(join(published, 'rows.ndjson'), '{}\n')
  await expect(syncDatasetSnapshots(options)).rejects.toThrow(/checksum/i)
})
