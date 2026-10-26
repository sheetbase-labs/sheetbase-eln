import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataClient } from './data-client'
import { previewLines, uploadFileToExperiment } from './experiment-files'

describe('previewLines', () => {
  it('takes the first lines, whatever the line ending', () => {
    expect(previewLines('a\r\nb\nc\nd', 2)).toEqual(['a', 'b'])
    expect(previewLines(null)).toEqual([])
  })
})

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
    const rpc = vi.fn(async () => ({}))
    const file = new File(['x'], 'run.csv', { type: 'text/csv' })
    const result = await uploadFileToExperiment(
      { rpc } as unknown as DataClient,
      {
        projectId: 'prj',
        experimentId: 'exp',
        file,
      },
    )
    expect(result.fileIdentifier).toBe('FILE-0009')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/files/rec-1/upload')
    expect(rpc).toHaveBeenCalledWith('create_record_link', {
      p_source_record_id: 'exp',
      p_target_kind: 'file',
      p_target_identifier: 'FILE-0009',
      p_link_type: 'file',
      p_target_record_id: 'rec-1',
    })
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
    const rpc = vi.fn()
    await expect(
      uploadFileToExperiment({ rpc } as unknown as DataClient, {
        projectId: 'prj',
        experimentId: 'exp',
        file: new File(['x'], 'big.csv'),
      }),
    ).rejects.toThrow('Too large')
    expect(rpc).not.toHaveBeenCalled()
  })
})
