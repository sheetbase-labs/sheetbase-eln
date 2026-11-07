/**
 * Publishing to a repository, off the request path.
 *
 * `api.request_publication` queues an experiment or a dataset version. This
 * sweep builds its RO-Crate package as the person who asked (so the package
 * holds only what they can see), sends it to the repository as a draft and
 * reserves the DOI. Making the draft public is a second, deliberate step
 * (`api.publish_publication`); the sweep does it when it is asked for and not
 * before. Nothing is sent anywhere until an admin has added a repository and
 * its token in Settings > Integrations.
 */
import type { QueryResultRow } from 'pg'

import { PooledClient } from '#/db/pool.server'
import { env } from '#/env.server'
import { openSecret, secretKey } from '../connector-secrets.server'
import { buildElnArchive } from '../eln/eln-archive'
import { collectExperiment, RECORD_SELECT } from '../eln/routes'
import type { RecordWire } from '../eln/routes'
import { getObjectStorage } from '../file-storage'
import { loadDatasetFields, pagedRows } from '../export/routes'
import type { ExportRow } from '../export/delimited'
import { logger } from '../logger'
import { mintPostgrestToken } from '../postgrest-token'
import { postgrestSelect } from '../request-auth'
import { licenseById } from './licenses'
import { buildDatasetCrate } from './ro-crate'
import type { CrateOntologyTerm, CrateRun } from './ro-crate'
import { createDraft, publishDraft, RepositoryError } from './repositories'
import type { RepoFetch, RepositoryTarget } from './repositories'

export const PUBLISH_SWEEP_INTERVAL_MS = 30_000
const BATCH = 5
/** The one place a package is held in memory. */
const PACKAGE_FILE_BYTES = 256 * 1024 * 1024

export interface PublisherConnection {
  query: <T extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>
  end: () => Promise<void>
}

export interface PublisherDeps {
  connect: () => Promise<PublisherConnection>
  fetch?: RepoFetch
  /** A short-lived PostgREST token that reads as the person who asked. */
  tokenFor: (userId: string, workspaceId: string) => Promise<string>
  /** Opens the token sealed for a repository. */
  openToken: (sealed: string) => string
  now?: () => Date
  /** Replaces the package builders; tests use it to skip the HTTP reads. */
  buildPackage?: (
    row: PublicationJob,
    token: string,
    author: { name: string },
  ) => Promise<Built>
}

export interface PublicationJob extends QueryResultRow {
  id: string
  workspace_id: string
  object_kind: 'experiment' | 'dataset_version'
  object_id: string
  title: string
  license: string
  status: 'queued' | 'publishing'
  remote_id: string | null
  requested_by_user_id: string
  kind: RepositoryTarget['kind']
  base_url: string
  collection: string | null
  ciphertext: string | null
  target_name: string
  package_name: string | null
  doi: string | null
}

async function selectAll<T>(
  resource: string,
  query: string,
  token: string,
): Promise<T[]> {
  const res = await postgrestSelect<T[]>(resource, query, token)
  if (res.status >= 400) throw new Error(`${resource} could not be read`)
  return Array.isArray(res.body) ? res.body : []
}

export interface Built {
  name: string
  bytes: Uint8Array
  includesRunCrate: boolean
  description: string
  keywords: string[]
}

async function buildExperimentPackage(
  row: PublicationJob,
  token: string,
  author: { name: string },
): Promise<Built> {
  const record = (
    await selectAll<RecordWire>(
      'records',
      `id=eq.${row.object_id}&kind=eq.experiment&select=${RECORD_SELECT}&limit=1`,
      token,
    )
  )[0]
  if (!record) throw new Error('The experiment is no longer visible to the person who asked.')
  const experiment = await collectExperiment(
    record,
    {
      userId: row.requested_by_user_id,
      workspaceId: row.workspace_id,
      sessionId: 'publisher',
      token,
    },
    getObjectStorage(),
    { remainingFileBytes: PACKAGE_FILE_BYTES },
  )
  const license = licenseById(row.license)
  const { bytes } = await buildElnArchive({
    name: `${record.identifier} ${record.title}`,
    workspaceId: row.workspace_id,
    exportedAt: new Date().toISOString(),
    experiments: [experiment],
    license,
    authors: [author],
  })
  return {
    name: `${record.identifier}.eln`,
    bytes,
    includesRunCrate: false,
    description: `Experiment ${record.identifier}: ${record.title}. Packaged by Sheetbase as an .eln RO-Crate with its notebook, files, datasets, signatures and audit history.`,
    keywords: record.tags ?? [],
  }
}

interface VersionWire {
  id: string
  dataset_id: string
  label: string
  schema_version_id: string
  source_dataset_revision: number | string
  workspace_id: string
}

async function buildDatasetPackage(
  row: PublicationJob,
  token: string,
  author: { name: string },
): Promise<Built> {
  const version = (
    await selectAll<VersionWire>(
      'dataset_versions',
      `id=eq.${row.object_id}&select=id,dataset_id,label,schema_version_id,source_dataset_revision,workspace_id&limit=1`,
      token,
    )
  )[0]
  if (!version) throw new Error('The dataset version is no longer visible to the person who asked.')
  const dataset = (
    await selectAll<{ id: string; name: string; description: string | null; display_id: string | null }>(
      'datasets',
      `id=eq.${version.dataset_id}&select=id,name,description,display_id&limit=1`,
      token,
    )
  )[0]
  const fields = await loadDatasetFields(token, version.schema_version_id)
  const rows: ExportRow[] = []
  const paged = pagedRows('query_dataset_version_rows', { p_dataset_version_id: version.id }, token)
  for await (const r of paged.rows) {
    rows.push(r)
    if (rows.length > 500_000) throw new Error('This dataset version is too big to package.')
  }
  // Ontology terms on the columns.
  const terms: Record<string, CrateOntologyTerm[]> = {}
  if (fields.length > 0) {
    const annotations = await selectAll<{ target_id: string; iri: string; label: string; ontology: string }>(
      'ontology_annotations',
      `target_kind=eq.schema_field&target_id=in.(${fields.map((f) => f.id).join(',')})&select=target_id,iri,label,ontology`,
      token,
    ).catch(() => [])
    for (const a of annotations) {
      const field = fields.find((f) => f.id === a.target_id)
      if (!field) continue
      ;(terms[field.key] ??= []).push({ iri: a.iri, label: a.label, ontology: a.ontology })
    }
  }
  // The pipeline run that produced this version, if one did.
  let run: CrateRun | null = null
  const output = (
    await selectAll<{ run_id: string }>(
      'pipeline_run_outputs',
      `dataset_version_id=eq.${version.id}&select=run_id&order=created_at.desc&limit=1`,
      token,
    ).catch(() => [])
  )[0]
  if (output) {
    const pr = (
      await selectAll<{
        id: string
        status: string
        trigger_kind: string
        started_at: string
        finished_at: string | null
        parameters: unknown
        input_versions: unknown
        input_digest: string | null
        definition_version_id: string
        actor_user_id: string | null
      }>(
        'pipeline_runs',
        `id=eq.${output.run_id}&select=id,status,trigger_kind,started_at,finished_at,parameters,input_versions,input_digest,definition_version_id,actor_user_id&limit=1`,
        token,
      )
    )[0]
    if (pr) {
      const dv = (
        await selectAll<{ id: string; definition_id: string; version: number; configuration: unknown }>(
          'pipeline_definition_versions',
          `id=eq.${pr.definition_version_id}&select=id,definition_id,version,configuration&limit=1`,
          token,
        )
      )[0]
      const def = dv
        ? (
            await selectAll<{ key: string; name: string }>(
              'pipeline_definitions',
              `id=eq.${dv.definition_id}&select=key,name&limit=1`,
              token,
            )
          )[0]
        : undefined
      const manifest = (
        await selectAll<{ manifest_digest: string }>(
          'pipeline_run_manifests',
          `run_id=eq.${pr.id}&select=manifest_digest&order=sequence.desc&limit=1`,
          token,
        ).catch(() => [])
      )[0]
      if (dv && def) {
        run = {
          id: pr.id,
          status: pr.status,
          triggerKind: pr.trigger_kind,
          startedAt: pr.started_at,
          finishedAt: pr.finished_at,
          actorName: null,
          parameters: pr.parameters,
          inputVersions: pr.input_versions,
          inputDigest: pr.input_digest,
          manifestDigest: manifest?.manifest_digest ?? null,
          pipeline: {
            key: def.key,
            name: def.name,
            version: dv.version,
            configuration: dv.configuration,
          },
        }
      }
    }
  }
  const crate = await buildDatasetCrate({
    name: dataset?.name ?? row.title,
    description: dataset?.description ?? null,
    datasetId: version.dataset_id,
    datasetDisplayId: dataset?.display_id ?? null,
    versionId: version.id,
    versionLabel: version.label,
    contentHash: null,
    exportedAt: new Date().toISOString(),
    fields,
    rows,
    terms,
    authors: [author],
    license: licenseById(row.license),
    doi: null,
    run,
  })
  return {
    name: crate.fileName,
    bytes: crate.bytes,
    includesRunCrate: crate.includesRunCrate,
    description:
      `${dataset?.name ?? row.title}, snapshot ${version.label}${dataset?.display_id ? ` (${dataset.display_id})` : ''}. ` +
      `Packaged by Sheetbase as an RO-Crate with its columns, units and ontology terms` +
      (crate.includesRunCrate ? ', and a Workflow Run Crate for the pipeline run that produced it.' : '.'),
    keywords: ['Sheetbase', 'dataset', ...(run ? ['provenance'] : [])],
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

export async function sweepPublications(
  deps: PublisherDeps,
): Promise<{ drafted: number; published: number; failed: number }> {
  const conn = await deps.connect()
  const result = { drafted: 0, published: 0, failed: 0 }
  try {
    const { rows } = await conn.query<PublicationJob>(
      `SELECT * FROM internal.publications_due($1)`,
      [BATCH],
    )
    for (const row of rows) {
      const stage = row.status === 'publishing' ? 'publish' : 'send'
      try {
        if (!row.ciphertext) throw new Error('The repository has no token yet.')
        const target: RepositoryTarget = {
          kind: row.kind,
          baseUrl: row.base_url,
          collection: row.collection,
          token: deps.openToken(row.ciphertext),
        }
        if (stage === 'publish') {
          if (!row.remote_id) throw new Error('There is no draft to publish.')
          const record = await publishDraft(target, row.remote_id, { fetch: deps.fetch })
          await conn.query(
            `SELECT internal.record_publication_published($1, $2, $3)`,
            [row.id, record.doi, record.recordUrl],
          )
          result.published++
          continue
        }
        const claimed = await conn.query<{ ok: boolean }>(
          `SELECT internal.mark_publication_sending($1) AS ok`,
          [row.id],
        )
        if (!claimed.rows[0]?.ok) continue
        const user = (
          await conn.query<{ name: string | null; email: string | null }>(
            `SELECT name, email FROM internal."user" WHERE id = $1`,
            [row.requested_by_user_id],
          )
        ).rows[0]
        const author = { name: user?.name || user?.email || 'Sheetbase author' }
        const token = await deps.tokenFor(row.requested_by_user_id, row.workspace_id)
        const built = deps.buildPackage
          ? await deps.buildPackage(row, token, author)
          : row.object_kind === 'experiment'
            ? await buildExperimentPackage(row, token, author)
            : await buildDatasetPackage(row, token, author)
        const draft = await createDraft(
          target,
          {
            title: row.title,
            description: built.description,
            creators: [author],
            license: licenseById(row.license),
            keywords: built.keywords,
            publicationDate: (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
            contactEmail: user?.email ?? null,
            publisher: row.target_name,
          },
          { name: built.name, bytes: built.bytes },
          { fetch: deps.fetch },
        )
        await conn.query(
          `SELECT internal.record_publication_draft($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            row.id,
            draft.remoteId,
            draft.draftUrl,
            draft.doi,
            built.name,
            built.bytes.length,
            await sha256Hex(built.bytes),
            built.includesRunCrate,
          ],
        )
        result.drafted++
      } catch (error) {
        result.failed++
        const message =
          error instanceof RepositoryError || error instanceof Error
            ? error.message
            : String(error)
        logger.warn('publication step failed', { publicationId: row.id, stage, error: message })
        await conn.query(`SELECT internal.record_publication_failure($1, $2, $3)`, [
          row.id,
          stage,
          message,
        ])
      }
    }
    return result
  } finally {
    await conn.end()
  }
}

export function realPublisherDeps(): PublisherDeps {
  return {
    connect: async () => {
      const client = new PooledClient({ connectionString: env.DATABASE_URL })
      await client.connect()
      return client
    },
    tokenFor: (userId, workspaceId) =>
      mintPostgrestToken(env.PGRST_JWT_SECRET, {
        userId,
        workspaceId,
        sessionId: 'publisher',
        ttlSeconds: 900,
      }),
    openToken: (sealed) => openSecret(sealed, secretKey()),
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
let running = false
const startedGlobalKey = '__sheetbasePublisherStarted'

function schedulerDisabled(): boolean {
  if (process.env.SHEETBASE_SCHEDULER_ENABLED === 'false') return true
  const inTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
  return inTest && process.env.SHEETBASE_SCHEDULER_ENABLED !== 'true'
}

export function startPublisher(
  options: { deps?: PublisherDeps; intervalMs?: number } = {},
): void {
  if (typeof window !== 'undefined') return
  if (schedulerDisabled()) return
  const g = globalThis as unknown as Record<string, unknown>
  if (g[startedGlobalKey]) return
  g[startedGlobalKey] = true
  const tick = async () => {
    if (running) return
    running = true
    try {
      const r = await sweepPublications(options.deps ?? realPublisherDeps())
      if (r.drafted || r.published || r.failed) logger.info('publications swept', r)
    } catch (error) {
      logger.warn('publication sweep failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }
  bootTimer = setTimeout(() => void tick(), 25_000)
  bootTimer.unref()
  timer = setInterval(() => void tick(), options.intervalMs ?? PUBLISH_SWEEP_INTERVAL_MS)
  timer.unref()
}

export function stopPublisher(): void {
  if (bootTimer) clearTimeout(bootTimer)
  if (timer) clearInterval(timer)
  bootTimer = null
  timer = null
  delete (globalThis as unknown as Record<string, unknown>)[startedGlobalKey]
}
