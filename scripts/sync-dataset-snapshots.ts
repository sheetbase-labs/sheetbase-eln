import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

import { SheetbaseClient } from '../sdks/typescript/src/client'
import { ValidationError } from '../sdks/typescript/src/errors'

const uuid = z.uuid()
const checksum = z.string().regex(/^[a-f0-9]{64}$/)
const inventory = z.array(
  z.object({ id: uuid, dataset_id: uuid, workspace_id: uuid }),
)
const pageSchema = z.object({
  format: z.literal('sheetbase.dataset-version-transfer/1'),
  metadataJson: z.string(),
  metadataChecksum: checksum,
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(1000),
  totalCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  hasMore: z.boolean(),
  rows: z
    .array(
      z.object({ rowId: uuid, canonicalJson: z.string(), sha256: checksum }),
    )
    .max(1000),
  pageChecksum: checksum,
  snapshotChecksum: checksum.nullable(),
})
const metadataSchema = z.object({
  workspaceId: uuid,
  datasetId: uuid,
  datasetVersionId: uuid,
  totalCount: z.string().regex(/^\d+$/),
})
const rowSchema = z.object({
  rowId: uuid,
  revision: z.string().regex(/^\d+$/),
  values: z.record(z.string(), z.unknown()),
  flags: z.array(z.unknown()),
})
const manifestSchema = z.object({
  format: z.literal('sheetbase.dataset-version-transfer/1'),
  sourceUrl: z.string(),
  metadataChecksum: checksum,
  snapshotChecksum: checksum,
  totalCount: z.number().int().nonnegative(),
})
const digest = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex')

function requireMatch(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** One inventory reconciliation. Safe to repeat or invoke after a version notification. */
export async function syncDatasetSnapshots(options: {
  baseUrl: string
  credential: string
  workspaceId: string
  outputDirectory: string
}) {
  const { outputDirectory, credential } = options
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const client = new SheetbaseClient({
    baseUrl,
    credential,
    scopes: ['datasets:read', 'schema:read'],
    timeout: 60_000,
  })
  const workspaceId = uuid.parse(options.workspaceId)
  const counts: { published: number; existing: number; unavailable: string[] } =
    {
      published: 0,
      existing: 0,
      unavailable: [],
    }
  let cursor = ''
  for (;;) {
    const versions = inventory.parse(
      await client.tableGet('dataset_versions', {
        params: {
          select: 'id,dataset_id,workspace_id',
          workspace_id: `eq.${workspaceId}`,
          order: 'id.asc',
          limit: 1000,
          ...(cursor ? { id: `gt.${cursor}` } : {}),
        },
      }),
    )
    if (!versions.length) break
    for (const version of versions) {
      requireMatch(
        version.workspace_id === workspaceId && version.id > cursor,
        'Invalid snapshot inventory identity or order',
      )
      cursor = version.id
      const parent = join(outputDirectory, workspaceId, version.dataset_id)
      await mkdir(parent, { recursive: true, mode: 0o700 })
      const destination = join(parent, version.id)
      let existingManifest: string | undefined
      try {
        existingManifest = await readFile(
          join(destination, 'manifest.json'),
          'utf8',
        )
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error
      }
      if (existingManifest !== undefined) {
        // A marker alone is insufficient: detect local corruption before skipping transfer.
        const manifest = manifestSchema.parse(JSON.parse(existingManifest))
        const metadataJson = await readFile(
          join(destination, 'metadata.json'),
          'utf8',
        )
        const metadata = metadataSchema.parse(JSON.parse(metadataJson))
        requireMatch(
          manifest.sourceUrl === baseUrl &&
            metadata.workspaceId === workspaceId &&
            metadata.datasetId === version.dataset_id &&
            metadata.datasetVersionId === version.id,
          'Existing snapshot belongs to a different source',
        )
        requireMatch(
          digest(metadataJson) === manifest.metadataChecksum &&
            metadata.totalCount === String(manifest.totalCount),
          'Existing snapshot metadata checksum mismatch',
        )
        const aggregate = createHash('sha256').update(
          `${manifest.metadataChecksum}\n`,
        )
        let rows = 0
        const input = createReadStream(join(destination, 'rows.ndjson'))
        try {
          for await (const line of createInterface({
            input,
            crlfDelay: Infinity,
          })) {
            aggregate.update(`${digest(line)}\n`)
            rows += 1
          }
        } finally {
          input.destroy()
        }
        requireMatch(
          rows === manifest.totalCount &&
            aggregate.digest('hex') === manifest.snapshotChecksum,
          'Existing snapshot rows checksum mismatch',
        )
        counts.existing += 1
        continue
      }

      const staging = await mkdtemp(join(parent, '.partial-'))
      try {
        const output = await open(join(staging, 'rows.ndjson'), 'wx', 0o600)
        let offset = 0
        let previousRowId = ''
        let metadataChecksum: string | undefined
        const aggregate = createHash('sha256')
        try {
          for (;;) {
            const page = pageSchema.parse(
              await client.rpc('query_dataset_version_transfer', {
                p_dataset_version_id: version.id,
                p_offset: offset,
                p_limit: 1000,
              }),
            )
            const metadata = metadataSchema.parse(JSON.parse(page.metadataJson))
            requireMatch(
              metadata.workspaceId === workspaceId &&
                metadata.datasetId === version.dataset_id &&
                metadata.datasetVersionId === version.id,
              'Snapshot identity changed',
            )
            requireMatch(
              page.offset === offset &&
                page.limit === 1000 &&
                metadata.totalCount === String(page.totalCount),
              'Snapshot page boundary mismatch',
            )
            requireMatch(
              digest(page.metadataJson) === page.metadataChecksum,
              'Snapshot metadata checksum mismatch',
            )
            if (metadataChecksum === undefined) {
              metadataChecksum = page.metadataChecksum
              aggregate.update(`${metadataChecksum}\n`)
              await writeFile(
                join(staging, 'metadata.json'),
                page.metadataJson,
                { mode: 0o600, flag: 'wx' },
              )
            }
            requireMatch(
              metadataChecksum === page.metadataChecksum,
              'Snapshot metadata changed between pages',
            )
            const pageHash = createHash('sha256').update(
              `${metadataChecksum}\n`,
            )
            for (const row of page.rows) {
              const decoded = rowSchema.parse(JSON.parse(row.canonicalJson))
              requireMatch(
                row.rowId > previousRowId &&
                  decoded.rowId === row.rowId &&
                  !row.canonicalJson.includes('\n'),
                'Snapshot row identity or order mismatch',
              )
              requireMatch(
                digest(row.canonicalJson) === row.sha256,
                'Snapshot row checksum mismatch',
              )
              previousRowId = row.rowId
              pageHash.update(`${row.sha256}\n`)
              aggregate.update(`${row.sha256}\n`)
              await output.writeFile(`${row.canonicalJson}\n`)
            }
            requireMatch(
              pageHash.digest('hex') === page.pageChecksum,
              'Snapshot page checksum mismatch',
            )
            offset += page.rows.length
            requireMatch(
              offset <= page.totalCount &&
                page.hasMore === offset < page.totalCount,
              'Snapshot count mismatch',
            )
            if (page.hasMore) {
              requireMatch(
                page.rows.length > 0 && page.snapshotChecksum === null,
                'Incomplete snapshot page',
              )
              continue
            }
            const snapshotChecksum = aggregate.digest('hex')
            requireMatch(
              snapshotChecksum === page.snapshotChecksum,
              'Snapshot checksum mismatch',
            )
            await output.sync()
            await writeFile(
              join(staging, 'manifest.json'),
              JSON.stringify({
                format: page.format,
                sourceUrl: baseUrl,
                metadataChecksum,
                snapshotChecksum,
                totalCount: offset,
              }),
              { mode: 0o600, flag: 'wx' },
            )
            break
          }
        } finally {
          await output.close()
        }
        // Publish only a complete verified directory on the same filesystem.
        await rename(staging, destination)
        counts.published += 1
      } catch (error) {
        // Retention preserves version identities. Report this explicit server
        // outcome without letting an old pruned version block all later ones.
        if (
          error instanceof ValidationError &&
          /^\[validation_error\] Dataset Version rows were removed by retention(?: \(request_id=[^)]+\))?$/.test(
            error.message,
          )
        ) {
          counts.unavailable.push(version.id)
        } else {
          throw error
        }
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    }
  }
  return counts
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { values } = parseArgs({
      options: { output: { type: 'string' }, workspace: { type: 'string' } },
    })
    const baseUrl = process.env.SHEETBASE_URL
    const credential = process.env.SHEETBASE_CREDENTIAL
    if (!baseUrl || !credential || !values.output || !values.workspace) {
      throw new Error(
        'Set SHEETBASE_URL and SHEETBASE_CREDENTIAL, and supply --workspace UUID --output DIRECTORY',
      )
    }
    const result = await syncDatasetSnapshots({
      baseUrl,
      credential,
      workspaceId: values.workspace,
      outputDirectory: resolve(values.output),
    })
    console.log(result)
    if (result.unavailable.length) process.exitCode = 2
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Snapshot reconciliation failed',
    )
    process.exitCode = 1
  }
}
