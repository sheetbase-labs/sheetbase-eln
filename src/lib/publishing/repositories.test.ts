// @vitest-environment node
import assert from 'node:assert/strict'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  assertRepositoryUrl,
  createDraft,
  publishDraft,
  RepositoryError,
} from './repositories'
import type { DepositMeta, RepoFetch } from './repositories'
import { licenseById } from './licenses'

const meta: DepositMeta = {
  title: 'Growth curves',
  description: 'OD600 over time',
  creators: [{ name: 'Lovelace, Ada' }],
  license: licenseById('cc-by-4.0'),
  keywords: ['growth'],
  publicationDate: '2026-11-07',
  contactEmail: null,
  publisher: 'Sheetbase',
}

const pkg = { name: 'growth.zip', bytes: new Uint8Array([1, 2, 3]) }

interface Call {
  url: string
  method: string
  auth: string | undefined
  body: NonNullable<Parameters<RepoFetch>[1]>['body']
}

function fake(routes: Record<string, z.core.util.JSONType>) {
  const calls: Call[] = []

  const fetch: RepoFetch = async (url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({
      url,
      method,
      auth: init?.headers?.authorization,
      body: init?.body,
    })
    const key = `${method} ${new URL(url).pathname}`

    if (!(key in routes))
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => `no route ${key}`,
      }
    const value = routes[key]
    const text = JSON.stringify(value)

    return {
      ok: true,
      status: 200,
      json: async () => value,
      text: async () => text,
    }
  }

  return { fetch, calls }
}

describe('Zenodo', () => {
  const target = {
    kind: 'zenodo' as const,
    baseUrl: 'https://sandbox.zenodo.org/',
    collection: null,
    token: 'tok-123456',
  }

  it('makes a draft with a reserved DOI, uploads the package and sends the token', async () => {
    const { fetch, calls } = fake({
      'POST /api/deposit/depositions': {
        id: 77,
        links: { bucket: 'https://sandbox.zenodo.org/api/files/bucket-1' },
      },
      'PUT /api/files/bucket-1/growth.zip': {},
      'PUT /api/deposit/depositions/77': {
        metadata: { prereserve_doi: { doi: '10.5072/zenodo.77' } },
        links: { html: 'https://sandbox.zenodo.org/deposit/77' },
      },
    })

    const draft = await createDraft(target, meta, pkg, { fetch })
    expect(draft).toEqual({
      remoteId: '77',
      draftUrl: 'https://sandbox.zenodo.org/deposit/77',
      doi: '10.5072/zenodo.77',
    })
    expect(calls.every((c) => c.auth === 'Bearer tok-123456')).toBe(true)

    const described = calls.find(
      (c) => c.method === 'PUT' && c.url.endsWith('/depositions/77'),
    )

    expect(
      JSON.parse(z.string().parse(described?.body)).metadata,
    ).toMatchObject({
      title: 'Growth curves',
      license: 'cc-by-4.0',
      upload_type: 'dataset',
    })
  })

  it('publishes a draft and returns the DOI', async () => {
    const { fetch } = fake({
      'POST /api/deposit/depositions/77/actions/publish': {
        doi: '10.5072/zenodo.77',
        links: { record_html: 'https://sandbox.zenodo.org/records/77' },
      },
    })

    expect(await publishDraft(target, '77', { fetch })).toEqual({
      doi: '10.5072/zenodo.77',
      recordUrl: 'https://sandbox.zenodo.org/records/77',
    })
  })

  it('keeps arbitrary nonempty strings and tolerates primitive nested replies', async () => {
    const { fetch } = fake({
      'POST /api/deposit/depositions/77/actions/publish': {
        doi: '',
        metadata: { doi: '  ' },
        links: 42,
      },
    })

    expect(await publishDraft(target, '77', { fetch })).toEqual({
      doi: '  ',
      recordUrl: 'https://doi.org/  ',
    })
  })

  it('turns a refusal into a readable error', async () => {
    const { fetch } = fake({})
    await expect(
      createDraft(target, meta, pkg, { fetch }),
    ).rejects.toBeInstanceOf(RepositoryError)
  })
})

describe('InvenioRDM', () => {
  it('creates a draft record and uploads the package to it', async () => {
    const target = {
      kind: 'invenio' as const,
      baseUrl: 'https://repo.example.org',
      collection: null,
      token: 'tok-123456',
    }

    const { fetch, calls } = fake({
      'POST /api/records': {
        id: 'abcd-1234',
        pids: { doi: { identifier: '10.1234/abcd-1234' } },
        links: { self_html: 'https://repo.example.org/uploads/abcd-1234' },
      },
      'POST /api/records/abcd-1234/draft/files': {},
      'PUT /api/records/abcd-1234/draft/files/growth.zip/content': {},
      'POST /api/records/abcd-1234/draft/files/growth.zip/commit': {},
    })

    const draft = await createDraft(target, meta, pkg, { fetch })
    expect(draft.remoteId).toBe('abcd-1234')
    expect(
      calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
    ).toContain('PUT /api/records/abcd-1234/draft/files/growth.zip/content')
  })
})

describe('repository addresses', () => {
  it('allows a lab’s own server and refuses metadata services and credentials', () => {
    expect(() =>
      assertRepositoryUrl('https://repo.lab.internal/api'),
    ).not.toThrow()
    expect(() => assertRepositoryUrl('http://192.168.1.20:8080')).not.toThrow()
    expect(() => assertRepositoryUrl('http://169.254.169.254/latest')).toThrow(
      /not allowed/,
    )
    expect(() =>
      assertRepositoryUrl('https://user:pw@repo.example.org'),
    ).toThrow(/not allowed/)
    expect(() => assertRepositoryUrl('ftp://repo.example.org')).toThrow(
      /not allowed/,
    )
  })
})

describe('Dataverse package bytes', () => {
  const target = {
    kind: 'dataverse' as const,
    baseUrl: 'https://repo.example.org',
    collection: 'lab',
    token: 'tok-123456',
  }

  it('uploads only the selected view and retains native detached-buffer refusal', async () => {
    const { fetch, calls } = fake({
      'POST /api/dataverses/lab/datasets': {
        data: { persistentId: 'doi:10.9/native' },
      },
      'POST /api/datasets/:persistentId/add': {},
    })

    const bytes = new Uint8Array([91, 2, 4, 93]).subarray(1, 3)
    const draft = await createDraft(target, meta, { ...pkg, bytes }, { fetch })
    const upload = calls.at(1)
    assert.ok(upload?.body instanceof FormData)
    const file = upload.body.get('file')
    assert.ok(file instanceof Blob)

    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([2, 4])
    expect(draft.remoteId).toBe('doi:10.9/native')

    const detached = new Uint8Array([5, 7])
    structuredClone(detached.buffer, { transfer: [detached.buffer] })

    const refused = fake({
      'POST /api/dataverses/lab/datasets': {
        data: { persistentId: 'doi:10.9/refused' },
      },
    })

    await expect(
      createDraft(
        target,
        meta,
        { ...pkg, bytes: detached },
        { fetch: refused.fetch },
      ),
    ).rejects.toMatchObject({ name: 'TypeError' })
    expect(refused.calls).toHaveLength(1)
  })
})
