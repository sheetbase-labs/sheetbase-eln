import { describe, expect, it } from 'vitest'

import {
  fetchAgentStatus,
  fetchLiveAgentStatus,
  fetchRobotAgentStatus,
} from './agent-client'
import { getConnector, updateConnector } from './client'
import {
  discoverConnectorSource,
  importConnectorSource,
  previewConnectorSource,
  testConnectorConnection,
} from './enterprise/client'
import { postIntake } from './intake-client'
import { createDataClient } from '#/lib/data-client'

describe('enterprise source responses', () => {
  const identity = { workspaceId: 'workspace-1', connectorId: 'connector-1' }

  it('accepts the actual connection response without an invented summary', async () => {
    await expect(
      testConnectorConnection(identity, async () =>
        Response.json({ ok: true, detail: { schemas: 2 } }),
      ),
    ).resolves.toEqual({ ok: true, detail: { schemas: 2 } })
    await expect(
      testConnectorConnection(identity, async () =>
        Response.json({ ok: 'true' }),
      ),
    ).rejects.toThrow()
  })

  it.each([
    {
      objects: [
        {
          key: 'run.csv',
          byteSize: 42,
          lastModified: null,
          contentType: 'text/csv',
          versionId: null,
          etag: 'opaque',
        },
      ],
      continuationToken: 'next',
    },
    {
      schemas: ['science'],
      tables: [
        {
          schema: 'science',
          name: 'readings',
          kind: 'view',
          columns: [{ name: 'result', dataType: 'numeric', nullable: true }],
        },
      ],
    },
  ])(
    'decodes discovery without conflating adapter results: %j',
    async (result) => {
      await expect(
        discoverConnectorSource(identity, async () => Response.json(result)),
      ).resolves.toEqual(result)
    },
  )

  it('preserves own scientific cell keys and refuses malformed preview cells', async () => {
    const input = { ...identity, selector: { key: 'run.json' } }

    const result = await previewConnectorSource(
      input,
      async () =>
        new Response(
          '{"columns":["__proto__","reading"],"rows":[{"__proto__":"kept","reading":null}],"truncated":false}',
          { headers: { 'content-type': 'application/json' } },
        ),
    )

    expect(Object.hasOwn(result.rows[0], '__proto__')).toBe(true)
    expect(result.rows[0]['__proto__']).toBe('kept')
    expect(result.rows[0].reading).toBeNull()
    await expect(
      previewConnectorSource(
        input,
        async () =>
          new Response(
            '{"columns":["__proto__"],"rows":[{"__proto__":{"untrusted":true}}],"truncated":false}',
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    ).rejects.toThrow()
  })

  it('decodes the governed import receipt and keeps server refusals actionable', async () => {
    const receipt = {
      runId: 'run-1',
      attempt: 2,
      alreadyCompleted: false,
      rowCount: 3,
      datasetId: 'dataset-1',
      datasetRevision: 4,
    }

    const input = {
      ...identity,
      source: { schema: 'science', table: 'readings' },
      target: { schemaVersionId: 'schema-1', fields: [] },
    }

    await expect(
      importConnectorSource(input, async () => Response.json(receipt)),
    ).resolves.toEqual(receipt)
    await expect(
      importConnectorSource(input, async () =>
        Response.json({ ...receipt, rowCount: '3' }),
      ),
    ).rejects.toThrow()
    await expect(
      importConnectorSource(input, async () =>
        Response.json(
          { error: { message: 'Source access denied' } },
          { status: 403 },
        ),
      ),
    ).rejects.toThrow('Source access denied')
    await expect(
      importConnectorSource(input, async () =>
        Response.json({ error: null }, { status: 503 }),
      ),
    ).rejects.toThrow('The connector operation failed.')
  })
})

describe('postIntake', () => {
  const request = { kind: 'retry', failureId: 'failure-1' } as const

  const result = {
    runId: 'run-1',
    alreadyCompleted: false,
    datasetId: 'dataset-1',
    datasetRevision: 4,
    rowCount: 2,
    parser: 'plate@1',
    fileRecordId: null,
    warnings: ['Check calibration'],
    instrumentRunId: 'instrument-run-1',
  }

  it('preserves valid results including additional server metadata', async () => {
    await expect(
      postIntake(request, () => Promise.resolve(Response.json(result))),
    ).resolves.toEqual(result)
  })

  it.each([{}, { ...result, warnings: [42] }, null])(
    'rejects incomplete and malformed success bodies: %j',
    async (payload) => {
      await expect(
        postIntake(request, () => Promise.resolve(Response.json(payload))),
      ).rejects.toMatchObject({
        name: 'IntakeClientError',
        code: 'intake_failed',
      })
    },
  )

  it('keeps the server failure code and retry identity', async () => {
    await expect(
      postIntake(request, () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: 'parser_unrecognised',
                message: 'Required columns missing',
              },
              failureId: 'failure-2',
            },
            { status: 422 },
          ),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'parser_unrecognised',
      message: 'Required columns missing',
      failureId: 'failure-2',
    })
  })
})

describe.each([fetchAgentStatus, fetchLiveAgentStatus, fetchRobotAgentStatus])(
  'agent status %s',
  (fetchStatus) => {
    it('returns the decoded status and rejects malformed successful responses', async () => {
      const status = {
        downloaded: true,
        lastSeenAt: '2026-11-09T12:00:00Z',
        running: false,
      }

      await expect(
        fetchStatus('instrument-1', () =>
          Promise.resolve(Response.json(status)),
        ),
      ).resolves.toEqual(status)
      await expect(
        fetchStatus('instrument-1', () =>
          Promise.resolve(Response.json({ ...status, running: 'false' })),
        ),
      ).rejects.toThrow()
    })

    it('reports server errors without trusting a malformed error envelope', async () => {
      await expect(
        fetchStatus('instrument-1', () =>
          Promise.resolve(
            Response.json(
              { error: { message: 'Agent unavailable' } },
              { status: 503 },
            ),
          ),
        ),
      ).rejects.toThrow('Agent unavailable')
      await expect(
        fetchStatus('instrument-1', () =>
          Promise.resolve(Response.json({ error: null }, { status: 503 })),
        ),
      ).rejects.toThrow()
    })
  },
)

function recording() {
  const queries: string[] = []

  const client = createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://localhost'),
      init,
    )

    queries.push(new URL(request.url).search)

    return Response.json([{ id: 'c-1', key: 'document-management' }])
  })

  return { client, queries }
}

describe('getConnector', () => {
  it('looks a connector up by id when given a uuid', async () => {
    const { client, queries } = recording()
    await getConnector(client, 'ad1cb5f7-f4f9-4595-9b07-09e733b68429')
    expect(queries[0]).toContain('&id=eq.ad1cb5f7')
  })

  it('looks it up by key when the address carries the readable name', async () => {
    const { client, queries } = recording()
    await getConnector(client, 'document-management')
    expect(queries[0]).toContain('&key=eq.document-management')
  })
})

describe('updateConnector', () => {
  it.each([
    { parserId: undefined, parserArgs: {} },
    { parserId: null, parserArgs: { p_clear_parser: true } },
    { parserId: 'parser-2', parserArgs: { p_parser_id: 'parser-2' } },
  ])(
    'preserves the parser update intent for $parserId',
    async ({ parserId, parserArgs }) => {
      const payloads: unknown[] = []

      const client = createDataClient(async (input, init) => {
        const request = new Request(
          new URL(
            input instanceof Request ? input.url : input,
            'http://localhost',
          ),
          init,
        )

        payloads.push(await request.json())

        return Response.json({ id: 'connector-1' })
      })

      await updateConnector(client, {
        workspaceId: 'workspace-1',
        connectorId: 'connector-1',
        parserId,
      })

      expect(payloads).toEqual([
        {
          p_workspace_id: 'workspace-1',
          p_connector_id: 'connector-1',
          p_name: null,
          p_status: null,
          p_config: null,
          ...parserArgs,
        },
      ])
    },
  )
})
