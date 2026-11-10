import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient } from './data-client'
import {
  previewLines,
  uploadFileToExperiment,
  uploadFileVersion,
} from './experiment-files'

describe('previewLines', () => {
  it('takes the first lines, whatever the line ending', () => {
    expect(previewLines('a\r\nb\nc\nd', 2)).toEqual(['a', 'b'])
    expect(previewLines(null)).toEqual([])
  })
})

/**
 * The RPC boundary the upload reaches: a real data client over a recorded
 * fetch, so the link call is checked as the request it actually makes.
 */
function linkClient() {
  const rpcCalls: Array<{ name: string; args: unknown }> = []

  const client = createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://app.test'),
      init,
    )

    rpcCalls.push({
      name: request.url.replace('http://app.test/api/db/rpc/', ''),
      args: await request.json(),
    })

    return Response.json({})
  })

  return { client, rpcCalls }
}

describe('uploadFileToExperiment', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('authorises, streams the bytes, then links the file to the experiment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fileRecordId: 'rec-1',
            fileIdentifier: 'FILE-0009',
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    vi.stubGlobal('fetch', fetchMock)
    const { client, rpcCalls } = linkClient()
    const file = new File(['x'], 'run.csv', { type: 'text/csv' })

    const result = await uploadFileToExperiment(client, {
      projectId: 'prj',
      experimentId: 'exp',
      file,
    })

    expect(result.fileIdentifier).toBe('FILE-0009')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/files/rec-1/upload')
    expect(rpcCalls).toEqual([
      {
        name: 'create_record_link',
        args: {
          p_source_record_id: 'exp',
          p_target_kind: 'file',
          p_target_identifier: 'FILE-0009',
          p_link_type: 'file',
          p_target_record_id: 'rec-1',
        },
      },
    ])
  })

  it('reports the refusal and links nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Too large' } }), {
          status: 413,
        }),
      ),
    )
    const { client, rpcCalls } = linkClient()
    await expect(
      uploadFileToExperiment(client, {
        projectId: 'prj',
        experimentId: 'exp',
        file: new File(['x'], 'big.csv'),
      }),
    ).rejects.toThrow('Too large')
    expect(rpcCalls).toEqual([])
  })
})

describe('uploadFileVersion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('puts the bytes to the version route under the new file name', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ version: 3 }, { status: 200 }))

    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['a,b'], 'plates v2.csv', { type: 'text/csv' })
    const result = await uploadFileVersion({ fileId: 'f-1', file })
    expect(result.version).toBe(3)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/files/f-1/version?name=plates%20v2.csv')
    expect(init.method).toBe('PUT')
  })

  it('reports why a version was refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: 'The file is locked.' } },
            { status: 409 },
          ),
        ),
    )
    await expect(
      uploadFileVersion({ fileId: 'f-1', file: new File(['x'], 'x.csv') }),
    ).rejects.toThrow('The file is locked.')
  })
})
