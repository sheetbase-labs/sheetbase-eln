import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { S3Client } from '@aws-sdk/client-s3'

import { S3ObjectStorage } from './s3'
import { MissingStorageObjectError, OversizeError } from './types'

const config = {
  bucket: 'lab-files',
  region: 'us-east-1',
  pathStyle: true,
  prefix: 'sheetbase',
}

/** An in-memory stand-in for an S3-compatible service. */
function fakeService() {
  const objects = new Map<string, Buffer>()
  const calls: string[] = []
  const client = {
    async send(command: {
      constructor: { name: string }
      input: Record<string, unknown>
    }) {
      const name = command.constructor.name
      const key = `${command.input.Bucket}/${command.input.Key}`
      calls.push(`${name} ${key}`)
      if (name === 'PutObjectCommand') {
        const chunks: Buffer[] = []
        for await (const c of command.input.Body as Readable) chunks.push(c)
        const body = Buffer.concat(chunks)
        if (body.length !== command.input.ContentLength) {
          throw new Error('length mismatch')
        }
        objects.set(key, body)
        return {}
      }
      const found = objects.get(key)
      if (!found) {
        throw Object.assign(new Error('missing'), {
          name: name === 'HeadObjectCommand' ? 'NotFound' : 'NoSuchKey',
          $metadata: { httpStatusCode: 404 },
        })
      }
      if (name === 'GetObjectCommand') {
        return {
          ContentLength: found.length,
          Body: {
            transformToWebStream: () => Readable.toWeb(Readable.from([found])),
          },
        }
      }
      if (name === 'HeadObjectCommand') return { ContentLength: found.length }
      if (name === 'DeleteObjectCommand') {
        objects.delete(key)
        return {}
      }
      throw new Error(`unexpected ${name}`)
    },
  }
  return { client: client as unknown as S3Client, objects, calls }
}

const streamOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes)
      c.close()
    },
  })

async function readAll(stream: ReadableStream<Uint8Array>) {
  const out: Buffer[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(Buffer.from(value))
  }
  return Buffer.concat(out)
}

describe('S3ObjectStorage', () => {
  it('writes under the prefix with the exact length and returns the checksum', async () => {
    const { client, objects } = fakeService()
    const storage = new S3ObjectStorage(config, client)
    const bytes = Buffer.from('plate reader export')
    const result = await storage.putStream('ws/file/abc', streamOf(bytes), 1000)
    expect(result.byteSize).toBe(BigInt(bytes.length))
    expect(result.checksum).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    )
    expect([...objects.keys()]).toEqual(['lab-files/sheetbase/ws/file/abc'])
  })

  it('reads, sizes and deletes an object', async () => {
    const { client } = fakeService()
    const storage = new S3ObjectStorage(config, client)
    await storage.putStream('k', streamOf(Buffer.from('hello')), 100)
    expect(await storage.head('k')).toEqual({ byteSize: 5 })
    const read = await storage.getStream('k')
    expect(read.byteSize).toBe(5)
    expect((await readAll(read.stream)).toString()).toBe('hello')
    await storage.delete('k')
    expect(await storage.head('k')).toBeNull()
  })

  it('reports a missing object the way the other backends do', async () => {
    const storage = new S3ObjectStorage(config, fakeService().client)
    await expect(storage.getStream('nope')).rejects.toBeInstanceOf(
      MissingStorageObjectError,
    )
  })

  it('stops an oversized upload before sending anything', async () => {
    const { client, calls } = fakeService()
    const storage = new S3ObjectStorage(config, client)
    await expect(
      storage.putStream('big', streamOf(Buffer.alloc(500)), 100),
    ).rejects.toBeInstanceOf(OversizeError)
    expect(calls).toEqual([])
  })
})
