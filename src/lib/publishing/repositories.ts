/**
 * Clients for the repositories a workspace can publish to. Each one does the
 * same two things:
 *
 *  - `createDraft` sends the package and the description as a draft the world
 *    cannot see yet, and reserves the DOI;
 *  - `publishDraft` makes the draft public, which registers the DOI for good.
 *
 * Zenodo (and its sandbox), InvenioRDM instances, Figshare and Dataverse are
 * supported. The calls follow each service's published REST API. Anything the
 * service refuses comes back as a `RepositoryError` carrying its own words so
 * the person can fix the cause (a missing licence, a token without the right
 * scope).
 */
import { createHash } from 'node:crypto'

import type { PublicationLicense } from './licenses'

export type RepositoryKind = 'zenodo' | 'invenio' | 'figshare' | 'dataverse'

export const REPOSITORY_KINDS: Array<{
  kind: RepositoryKind
  name: string
  defaultUrl: string | null
  collectionLabel: string | null
}> = [
  {
    kind: 'zenodo',
    name: 'Zenodo',
    defaultUrl: 'https://zenodo.org',
    collectionLabel: null,
  },
  {
    kind: 'invenio',
    name: 'InvenioRDM',
    defaultUrl: null,
    collectionLabel: null,
  },
  {
    kind: 'figshare',
    name: 'Figshare',
    defaultUrl: 'https://api.figshare.com/v2',
    collectionLabel: 'Category ids',
  },
  {
    kind: 'dataverse',
    name: 'Dataverse',
    defaultUrl: null,
    collectionLabel: 'Collection alias',
  },
]

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'RepositoryError'
  }
}

export interface RepositoryTarget {
  kind: RepositoryKind
  baseUrl: string
  collection: string | null
  token: string
}

export interface DepositMeta {
  title: string
  description: string
  creators: Array<{ name: string }>
  license: PublicationLicense
  keywords: string[]
  /** YYYY-MM-DD */
  publicationDate: string
  contactEmail: string | null
  publisher: string
}

export interface DepositPackage {
  name: string
  bytes: Uint8Array
}

export interface RepositoryDraft {
  remoteId: string
  draftUrl: string
  doi: string | null
}

export interface RepositoryRecord {
  doi: string
  recordUrl: string
}

export type RepoFetch = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string | Uint8Array | FormData
  },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface RepositoryDeps {
  fetch?: RepoFetch
}

type Json = Record<string, unknown>

const joinUrl = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}${path.startsWith('/') ? '' : '/'}${path}`

async function call(
  deps: RepositoryDeps,
  url: string,
  init: Parameters<RepoFetch>[1],
  what: string,
): Promise<Json> {
  const fetcher: RepoFetch =
    deps.fetch ?? ((u, i) => fetch(u, i as RequestInit))
  const res = await fetcher(url, init)
  const raw = await res.text()
  let body: unknown = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    body = null
  }
  if (!res.ok) {
    const detail =
      (body as { message?: unknown; errors?: unknown; status?: unknown } | null)
        ?.message ?? (body as { errors?: unknown } | null)?.errors
    const text =
      typeof detail === 'string'
        ? detail
        : detail
          ? JSON.stringify(detail)
          : raw
    throw new RepositoryError(
      `${what} failed (${res.status})${text ? `: ${text.slice(0, 300)}` : ''}`,
      res.status,
    )
  }
  return (body ?? {}) as Json
}

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null

const bearer = (token: string) => ({
  authorization: `Bearer ${token}`,
})

// ---------------------------------------------------------------- Zenodo

async function zenodoDraft(
  target: RepositoryTarget,
  meta: DepositMeta,
  pkg: DepositPackage,
  deps: RepositoryDeps,
): Promise<RepositoryDraft> {
  const headers = {
    ...bearer(target.token),
    'content-type': 'application/json',
  }
  const created = await call(
    deps,
    joinUrl(target.baseUrl, '/api/deposit/depositions'),
    { method: 'POST', headers, body: '{}' },
    'Creating the Zenodo deposit',
  )
  const id = String(created.id ?? '')
  const bucket = asString((created.links as Json | undefined)?.bucket)
  if (!id || !bucket)
    throw new RepositoryError('Zenodo did not return a deposit to upload to.')
  await call(
    deps,
    joinUrl(bucket, encodeURIComponent(pkg.name)),
    {
      method: 'PUT',
      headers: {
        ...bearer(target.token),
        'content-type': 'application/octet-stream',
      },
      body: pkg.bytes,
    },
    'Uploading the package to Zenodo',
  )
  const updated = await call(
    deps,
    joinUrl(target.baseUrl, `/api/deposit/depositions/${id}`),
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        metadata: {
          title: meta.title,
          upload_type: 'dataset',
          description: meta.description,
          creators: meta.creators.map((c) => ({ name: c.name })),
          license: meta.license.id,
          keywords: meta.keywords,
          access_right: 'open',
          publication_date: meta.publicationDate,
        },
      }),
    },
    'Describing the Zenodo deposit',
  )
  const doi = asString(
    ((updated.metadata as Json | undefined)?.prereserve_doi as Json | undefined)
      ?.doi,
  )
  return {
    remoteId: id,
    draftUrl:
      asString((updated.links as Json | undefined)?.html) ??
      joinUrl(target.baseUrl, `/deposit/${id}`),
    doi,
  }
}

async function zenodoPublish(
  target: RepositoryTarget,
  remoteId: string,
  deps: RepositoryDeps,
): Promise<RepositoryRecord> {
  const done = await call(
    deps,
    joinUrl(
      target.baseUrl,
      `/api/deposit/depositions/${remoteId}/actions/publish`,
    ),
    { method: 'POST', headers: bearer(target.token) },
    'Publishing on Zenodo',
  )
  const doi =
    asString(done.doi) ?? asString((done.metadata as Json | undefined)?.doi)
  if (!doi)
    throw new RepositoryError('Zenodo published the record but gave no DOI.')
  return {
    doi,
    recordUrl:
      asString((done.links as Json | undefined)?.record_html) ??
      asString((done.links as Json | undefined)?.html) ??
      `https://doi.org/${doi}`,
  }
}

// ------------------------------------------------------------- InvenioRDM

function personName(name: string): { family_name: string; given_name: string } {
  const comma = name.indexOf(',')
  if (comma > 0) {
    return {
      family_name: name.slice(0, comma).trim(),
      given_name: name.slice(comma + 1).trim(),
    }
  }
  const parts = name.trim().split(/\s+/)
  return {
    family_name: parts.at(-1) ?? name,
    given_name: parts.slice(0, -1).join(' '),
  }
}

async function invenioDraft(
  target: RepositoryTarget,
  meta: DepositMeta,
  pkg: DepositPackage,
  deps: RepositoryDeps,
): Promise<RepositoryDraft> {
  const headers = {
    ...bearer(target.token),
    'content-type': 'application/json',
  }
  const created = await call(
    deps,
    joinUrl(target.baseUrl, '/api/records'),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        access: { record: 'public', files: 'public' },
        files: { enabled: true },
        metadata: {
          resource_type: { id: 'dataset' },
          title: meta.title,
          description: meta.description,
          publication_date: meta.publicationDate,
          publisher: meta.publisher,
          creators: meta.creators.map((c) => ({
            person_or_org: { type: 'personal', ...personName(c.name) },
          })),
          rights: [{ id: meta.license.id }],
          subjects: meta.keywords.map((k) => ({ subject: k })),
        },
      }),
    },
    'Creating the InvenioRDM draft',
  )
  const id = asString(created.id)
  if (!id) throw new RepositoryError('The repository did not return a draft.')
  const files = joinUrl(target.baseUrl, `/api/records/${id}/draft/files`)
  const key = encodeURIComponent(pkg.name)
  await call(
    deps,
    files,
    { method: 'POST', headers, body: JSON.stringify([{ key: pkg.name }]) },
    'Registering the package',
  )
  await call(
    deps,
    `${files}/${key}/content`,
    {
      method: 'PUT',
      headers: {
        ...bearer(target.token),
        'content-type': 'application/octet-stream',
      },
      body: pkg.bytes,
    },
    'Uploading the package',
  )
  await call(
    deps,
    `${files}/${key}/commit`,
    { method: 'POST', headers: bearer(target.token) },
    'Finishing the upload',
  )
  let doi: string | null = null
  try {
    const reserved = await call(
      deps,
      joinUrl(target.baseUrl, `/api/records/${id}/draft/pids/doi`),
      { method: 'POST', headers: bearer(target.token) },
      'Reserving a DOI',
    )
    doi = asString(
      ((reserved.pids as Json | undefined)?.doi as Json | undefined)
        ?.identifier,
    )
  } catch (error) {
    // Some installs mint the DOI when the record is published instead.
    if (
      !(error instanceof RepositoryError) ||
      error.status === 401 ||
      error.status === 403
    )
      throw error
  }
  return {
    remoteId: id,
    draftUrl: joinUrl(target.baseUrl, `/uploads/${id}`),
    doi,
  }
}

async function invenioPublish(
  target: RepositoryTarget,
  remoteId: string,
  deps: RepositoryDeps,
): Promise<RepositoryRecord> {
  const done = await call(
    deps,
    joinUrl(target.baseUrl, `/api/records/${remoteId}/draft/actions/publish`),
    { method: 'POST', headers: bearer(target.token) },
    'Publishing the record',
  )
  const doi = asString(
    ((done.pids as Json | undefined)?.doi as Json | undefined)?.identifier,
  )
  if (!doi)
    throw new RepositoryError(
      'The record is public but this repository gave it no DOI.',
    )
  return {
    doi,
    recordUrl:
      asString((done.links as Json | undefined)?.self_html) ??
      joinUrl(target.baseUrl, `/records/${asString(done.id) ?? remoteId}`),
  }
}

// --------------------------------------------------------------- Figshare

async function figshareDraft(
  target: RepositoryTarget,
  meta: DepositMeta,
  pkg: DepositPackage,
  deps: RepositoryDeps,
): Promise<RepositoryDraft> {
  const headers = {
    ...bearer(target.token),
    'content-type': 'application/json',
  }
  const licenses = await fetchFigshareLicenses(target, deps)
  const license =
    licenses.find(
      (l) => l.url.replace(/\/+$/, '') === meta.license.url.replace(/\/+$/, ''),
    ) ??
    licenses.find((l) =>
      l.name
        .toLowerCase()
        .includes(meta.license.id.split('-').slice(0, 2).join(' ')),
    )
  if (!license) {
    throw new RepositoryError(
      `Figshare does not offer the licence ${meta.license.name}. Pick another.`,
    )
  }
  const categories = (target.collection ?? '')
    .split(',')
    .map((c) => Number(c.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
  const created = await call(
    deps,
    joinUrl(target.baseUrl, '/account/articles'),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: meta.title,
        description: meta.description,
        defined_type: 'dataset',
        tags: meta.keywords,
        keywords: meta.keywords,
        license: license.value,
        categories,
        authors: meta.creators.map((c) => ({ name: c.name })),
      }),
    },
    'Creating the Figshare item',
  )
  const location = asString(created.location)
  const id = location?.match(/(\d+)\/?$/)?.[1]
  if (!id)
    throw new RepositoryError('Figshare did not return an item to upload to.')
  const article = joinUrl(target.baseUrl, `/account/articles/${id}`)
  const md5 = createHash('md5').update(pkg.bytes).digest('hex')
  const file = await call(
    deps,
    `${article}/files`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: pkg.name, size: pkg.bytes.length, md5 }),
    },
    'Registering the package',
  )
  const fileUrl = asString(file.location)
  if (!fileUrl) throw new RepositoryError('Figshare did not return an upload.')
  const info = await call(
    deps,
    fileUrl,
    { headers: bearer(target.token) },
    'Reading the upload',
  )
  const uploadUrl = asString(info.upload_url)
  if (!uploadUrl)
    throw new RepositoryError('Figshare did not return an upload address.')
  const plan = await call(
    deps,
    uploadUrl,
    { headers: bearer(target.token) },
    'Planning the upload',
  )
  for (const part of (plan.parts as
    | Array<{
        partNo: number
        startOffset: number
        endOffset: number
      }>
    | undefined) ?? []) {
    await call(
      deps,
      `${uploadUrl}/${part.partNo}`,
      {
        method: 'PUT',
        headers: bearer(target.token),
        body: pkg.bytes.subarray(part.startOffset, part.endOffset + 1),
      },
      'Uploading the package',
    )
  }
  await call(
    deps,
    fileUrl,
    { method: 'POST', headers: bearer(target.token) },
    'Finishing the upload',
  )
  let doi: string | null = null
  try {
    const reserved = await call(
      deps,
      `${article}/reserve_doi`,
      { method: 'POST', headers: bearer(target.token) },
      'Reserving a DOI',
    )
    doi = asString(reserved.doi)
  } catch (error) {
    if (
      !(error instanceof RepositoryError) ||
      error.status === 401 ||
      error.status === 403
    )
      throw error
  }
  return {
    remoteId: id,
    draftUrl: `https://figshare.com/account/articles/${id}`,
    doi,
  }
}

async function fetchFigshareLicenses(
  target: RepositoryTarget,
  deps: RepositoryDeps,
): Promise<Array<{ value: number; name: string; url: string }>> {
  const fetcher: RepoFetch =
    deps.fetch ?? ((u, i) => fetch(u, i as RequestInit))
  const res = await fetcher(joinUrl(target.baseUrl, '/account/licenses'), {
    headers: bearer(target.token),
  })
  if (!res.ok)
    throw new RepositoryError(
      `Reading Figshare's licences failed (${res.status})`,
      res.status,
    )
  const list = (await res.json()) as Array<{
    value: number
    name: string
    url: string
  }>
  return Array.isArray(list) ? list : []
}

async function figsharePublish(
  target: RepositoryTarget,
  remoteId: string,
  deps: RepositoryDeps,
): Promise<RepositoryRecord> {
  const article = joinUrl(target.baseUrl, `/account/articles/${remoteId}`)
  await call(
    deps,
    `${article}/publish`,
    { method: 'POST', headers: bearer(target.token) },
    'Publishing on Figshare',
  )
  const pub = await call(
    deps,
    joinUrl(target.baseUrl, `/articles/${remoteId}`),
    { headers: bearer(target.token) },
    'Reading the published item',
  )
  const doi = asString(pub.doi)
  if (!doi)
    throw new RepositoryError('Figshare published the item but gave no DOI.')
  return {
    doi,
    recordUrl: asString(pub.url_public_html) ?? `https://doi.org/${doi}`,
  }
}

// -------------------------------------------------------------- Dataverse

function dvField(
  typeName: string,
  value: unknown,
  multiple = false,
  typeClass = 'primitive',
): Json {
  return { typeName, multiple, typeClass, value }
}

async function dataverseDraft(
  target: RepositoryTarget,
  meta: DepositMeta,
  pkg: DepositPackage,
  deps: RepositoryDeps,
): Promise<RepositoryDraft> {
  if (!target.collection) {
    throw new RepositoryError(
      'This Dataverse needs the alias of the collection to deposit into.',
    )
  }
  const headers = {
    'x-dataverse-key': target.token,
    'content-type': 'application/json',
  }
  const created = await call(
    deps,
    joinUrl(
      target.baseUrl,
      `/api/dataverses/${encodeURIComponent(target.collection)}/datasets`,
    ),
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasetVersion: {
          license: { name: meta.license.name, uri: meta.license.url },
          metadataBlocks: {
            citation: {
              displayName: 'Citation Metadata',
              fields: [
                dvField('title', meta.title),
                dvField(
                  'author',
                  meta.creators.map((c) => ({
                    authorName: dvField('authorName', c.name),
                  })),
                  true,
                  'compound',
                ),
                dvField(
                  'datasetContact',
                  [
                    {
                      datasetContactName: dvField(
                        'datasetContactName',
                        meta.creators[0]?.name ?? meta.publisher,
                      ),
                      datasetContactEmail: dvField(
                        'datasetContactEmail',
                        meta.contactEmail ?? 'unknown@example.org',
                      ),
                    },
                  ],
                  true,
                  'compound',
                ),
                dvField(
                  'dsDescription',
                  [
                    {
                      dsDescriptionValue: dvField(
                        'dsDescriptionValue',
                        meta.description,
                      ),
                    },
                  ],
                  true,
                  'compound',
                ),
                dvField('subject', ['Other'], true, 'controlledVocabulary'),
                dvField(
                  'keyword',
                  meta.keywords.map((k) => ({
                    keywordValue: dvField('keywordValue', k),
                  })),
                  true,
                  'compound',
                ),
              ],
            },
          },
        },
      }),
    },
    'Creating the Dataverse dataset',
  )
  const data = created.data as Json | undefined
  const persistentId = asString(data?.persistentId)
  if (!persistentId)
    throw new RepositoryError('Dataverse did not return a dataset identifier.')
  const form = new FormData()
  form.append(
    'file',
    new Blob([pkg.bytes as unknown as BlobPart], { type: 'application/zip' }),
    pkg.name,
  )
  form.append(
    'jsonData',
    JSON.stringify({
      description: 'RO-Crate package from Sheetbase',
      restrict: false,
    }),
  )
  await call(
    deps,
    joinUrl(
      target.baseUrl,
      `/api/datasets/:persistentId/add?persistentId=${encodeURIComponent(persistentId)}`,
    ),
    {
      method: 'POST',
      headers: { 'x-dataverse-key': target.token },
      body: form,
    },
    'Uploading the package to Dataverse',
  )
  return {
    remoteId: persistentId,
    draftUrl: joinUrl(
      target.baseUrl,
      `/dataset.xhtml?persistentId=${encodeURIComponent(persistentId)}&version=DRAFT`,
    ),
    doi: persistentId.replace(/^doi:/, ''),
  }
}

async function dataverseDoi(persistentId: string): Promise<string> {
  return persistentId.replace(/^doi:/, '')
}

async function dataversePublish(
  target: RepositoryTarget,
  remoteId: string,
  deps: RepositoryDeps,
): Promise<RepositoryRecord> {
  const done = await call(
    deps,
    joinUrl(
      target.baseUrl,
      `/api/datasets/:persistentId/actions/:publish?persistentId=${encodeURIComponent(remoteId)}&type=major`,
    ),
    { method: 'POST', headers: { 'x-dataverse-key': target.token } },
    'Publishing on Dataverse',
  )
  const doi = await dataverseDoi(remoteId)
  return {
    doi,
    recordUrl:
      asString((done.data as Json | undefined)?.persistentUrl) ??
      `https://doi.org/${doi}`,
  }
}

// ----------------------------------------------------------------- facade

export function createDraft(
  target: RepositoryTarget,
  meta: DepositMeta,
  pkg: DepositPackage,
  deps: RepositoryDeps = {},
): Promise<RepositoryDraft> {
  switch (target.kind) {
    case 'zenodo':
      return zenodoDraft(target, meta, pkg, deps)
    case 'invenio':
      return invenioDraft(target, meta, pkg, deps)
    case 'figshare':
      return figshareDraft(target, meta, pkg, deps)
    case 'dataverse':
      return dataverseDraft(target, meta, pkg, deps)
  }
}

export function publishDraft(
  target: RepositoryTarget,
  remoteId: string,
  deps: RepositoryDeps = {},
): Promise<RepositoryRecord> {
  switch (target.kind) {
    case 'zenodo':
      return zenodoPublish(target, remoteId, deps)
    case 'invenio':
      return invenioPublish(target, remoteId, deps)
    case 'figshare':
      return figsharePublish(target, remoteId, deps)
    case 'dataverse':
      return dataversePublish(target, remoteId, deps)
  }
}
