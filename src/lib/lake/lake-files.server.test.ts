import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { handleLakeFile } from './lake-files.server'
import type { LakeFileDeps } from './lake-files.server'
import { MissingStorageObjectError } from '../file-storage/types'

const WS = '00000000-0000-4000-8000-000000000300'
const OTHER = '00000000-0000-4000-8000-000000000301'
const SECRET = 'sbk_secret'
const HASH = createHash('sha256').update(SECRET).digest('hex')
const DATA = Uint8Array.from({ length: 100 }, (_, i) => i)

const deps: LakeFileDeps = {
  tokenWorkspace: async (hash) => (hash === HASH ? WS : null),
  storage: {
    getStream: async (key: string) => {
      if (key !== `lake/${WS}/main/samples/a.parquet`)
        throw new MissingStorageObjectError('absent')
      return {
        byteSize: DATA.length,
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(DATA)
            controller.close()
          },
        }),
      }
    },
  } as unknown as LakeFileDeps['storage'],
}

const get = (
  path: string,
  headers: Record<string, string> = {},
  workspace = WS,
) =>
  handleLakeFile(
    new Request(`http://x/${path}`, { headers }),
    workspace,
    path,
    deps,
  )
const auth = { authorization: `Bearer ${SECRET}` }

describe('lake file endpoint', () => {
  it('needs a login', async () => {
    expect((await get('main/samples/a.parquet')).status).toBe(401)
    expect(
      (await get('main/samples/a.parquet', { authorization: 'Bearer nope' }))
        .status,
    ).toBe(401)
  })

  it('does not serve another workspace', async () => {
    expect((await get('main/samples/a.parquet', auth, OTHER)).status).toBe(401)
  })

  it('serves only parquet files inside a table folder', async () => {
    expect((await get('main/samples/a.txt', auth)).status).toBe(404)
    expect((await get('main/../x/a.parquet', auth)).status).toBe(404)
    expect((await get('other/samples/a.parquet', auth)).status).toBe(404)
    expect((await get('main/samples/missing.parquet', auth)).status).toBe(404)
  })

  it('serves the file and honours ranges', async () => {
    const whole = await get('main/samples/a.parquet', auth)
    expect(whole.status).toBe(200)
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(DATA)
    const part = await get('main/samples/a.parquet', {
      ...auth,
      range: 'bytes=10-19',
    })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 10-19/100')
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(
      DATA.subarray(10, 20),
    )
    const tail = await get('main/samples/a.parquet', {
      ...auth,
      range: 'bytes=-5',
    })
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(DATA.subarray(95))
    expect(
      (await get('main/samples/a.parquet', { ...auth, range: 'bytes=500-' }))
        .status,
    ).toBe(416)
  })

  it('accepts the secret as a basic-auth password', async () => {
    const basic = `Basic ${Buffer.from(`user:${SECRET}`).toString('base64')}`
    expect(
      (await get('main/samples/a.parquet', { authorization: basic })).status,
    ).toBe(200)
  })
})
