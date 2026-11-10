import { once } from 'node:events'
import { createServer } from 'node:http'
import { z } from 'zod'

import type {
  DatasetImportRecord,
  ImportFileUploadResponse,
  ImportReviewResponse,
} from '#/lib/import/types'

export interface ImportTestRequest {
  method: string
  url: URL
  body: string
  filename: string | undefined
}

interface ImportTestState {
  datasets: boolean
  schemas: boolean
  experiments: {
    id: string
    identifier: string
    title: string
    project_id: string | null
  }[]
  datasetReady?: Promise<void>
  datasetFailure: boolean
  file: (url: URL) => ImportFileUploadResponse
  upload: ImportFileUploadResponse | null
  review: ImportReviewResponse | null
  receipts: DatasetImportRecord[]
  missingFile: boolean
  refuseMapping: boolean
}

type JsonReply =
  | z.infer<ReturnType<typeof z.json>>
  | ImportFileUploadResponse
  | ImportReviewResponse
  | DatasetImportRecord[]
  | null

export async function importFlowTestServer() {
  const requests: ImportTestRequest[] = []
  const unexpected: string[] = []
  const pending = new Set<Promise<Response>>()

  const state: ImportTestState = {
    datasets: false,
    schemas: false,
    experiments: [],
    datasetFailure: false,
    file: () => {
      throw new Error('Configure the retained file response')
    },
    upload: null,
    review: null,
    receipts: [],
    missingFile: false,
    refuseMapping: false,
  }

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://localhost')

      const filename = z
        .string()
        .optional()
        .parse(request.headers['x-import-filename'])

      requests.push({
        method: request.method ?? 'GET',
        url,
        body,
        filename: filename ? decodeURIComponent(filename) : undefined,
      })

      const send = (value: JsonReply, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(value))
      }

      const path = url.pathname

      if (path === '/api/db/datasets' && request.method === 'GET') {
        if (state.datasetFailure) {
          state.datasetFailure = false
          send(
            { error: { code: 'refused', message: 'The request was refused' } },
            403,
          )

          return
        }

        const sendDatasets = () =>
          send(
            state.datasets
              ? [
                  {
                    id: 'ds-1',
                    display_id: 'DS-0001',
                    workspace_id: 'ws-1',
                    schema_version_id: 'sv-1',
                    name: 'ELISA capsid titre',
                    description: null,
                    lifecycle: 'active',
                    revision: 1,
                  },
                ]
              : [],
          )

        if (state.datasetReady) void state.datasetReady.then(sendDatasets)
        else sendDatasets()
      } else if (path === '/api/db/dataset_schema_version_fields') {
        send(
          ['raw', 'dilution'].map((key, index) => ({
            field_id: `field-${index + 1}`,
            schema_version_id: 'sv-1',
            key,
            label: index === 0 ? 'Raw' : 'Dilution',
            logical_type: index === 0 ? 'decimal' : 'text',
            nullable: true,
            quantity: index === 0 ? { storageUnit: 'NTU' } : null,
            validation: {},
            lifecycle: 'active',
            display_order: index + 1,
          })),
        )
      } else if (path === '/api/db/dataset_schema_definitions') {
        send(
          state.schemas || url.searchParams.has('id')
            ? [
                {
                  id: 'sd-1',
                  key: 'elisa',
                  name: 'ELISA and turbidity',
                  description: null,
                  lifecycle: 'active',
                },
              ]
            : [],
        )
      } else if (path === '/api/db/dataset_schema_versions') {
        send(
          state.schemas || url.searchParams.has('id')
            ? [
                {
                  id: 'sv-1',
                  schema_id: 'sd-1',
                  version: 2,
                  lifecycle: 'active',
                  published_at: '2026-02-01T10:00:00Z',
                },
              ]
            : [],
        )
      } else if (path === '/api/db/datasets' && request.method === 'POST') {
        send([{ id: 'ds-new', revision: 1, name: 'New dataset' }])
      } else if (path === '/api/db/records') {
        send(state.experiments)
      } else if (path === '/api/import/files') {
        if (request.method === 'POST') send(state.upload)
        else if (state.missingFile)
          send(
            { error: { code: 'not_found', message: 'Import not found.' } },
            404,
          )
        else send(state.file(url))
      } else if (path === '/api/import/review') send(state.review)
      else if (path === '/api/import/commit')
        send({ ok: true, committed: 2, outcome: {} })
      else if (path === '/api/db/rpc/dataset_import_list') send(state.receipts)
      else if (path === '/api/db/rpc/save_parser_mapping') {
        if (state.refuseMapping)
          send(
            {
              error: {
                code: 'refused',
                message: 'You cannot change this parser.',
              },
            },
            403,
          )
        else send(null)
      } else if (
        [
          '/api/db/instruments',
          '/api/db/instrument_calibrations',
          '/api/db/extensions',
        ].includes(path)
      )
        send([])
      else {
        unexpected.push(`${request.method} ${request.url}`)
        send(
          {
            error: {
              code: 'unexpected',
              message: `Unexpected test request ${request.url}`,
            },
          },
          500,
        )
      }
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = z.object({ port: z.number() }).parse(server.address())
  const originalFetch = globalThis.fetch

  // jsdom Files are real DOM files, but Node's fetch does not recognise their
  // Blob implementation. Read their bytes rather than letting it stringify them.
  const forward: typeof fetch = async (input, init) => {
    let body = init?.body

    if (body instanceof Blob) {
      const blob = body
      body = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () =>
          reader.result instanceof ArrayBuffer
            ? resolve(reader.result)
            : reject(new Error('FileReader did not return file bytes'))
        reader.onerror = () =>
          reject(reader.error ?? new Error('File read failed'))
        reader.readAsArrayBuffer(blob)
      })
    }

    return originalFetch(
      new URL(
        input instanceof Request ? input.url : input,
        `http://127.0.0.1:${port}`,
      ),
      { ...init, body },
    )
  }

  globalThis.fetch = (input, init) => {
    const request = forward(input, init)

    pending.add(request)
    void request.then(
      () => pending.delete(request),
      () => pending.delete(request),
    )

    return request
  }

  return {
    state,
    requests,
    unexpected,
    matching: (path: string, method = 'POST') =>
      requests.filter(
        (request) => request.url.pathname === path && request.method === method,
      ),
    async idle() {
      while (pending.size > 0) await Promise.allSettled(pending)
    },
    async close() {
      globalThis.fetch = originalFetch
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
