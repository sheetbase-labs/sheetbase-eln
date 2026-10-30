import { describe, expect, it } from 'vitest'

import { ByteChannel } from './byte-channel'

const bytes = (n: number) => new Uint8Array(n).fill(7)

describe('ByteChannel', () => {
  it('delivers what was pushed, in order, and ends when closed', async () => {
    const channel = new ByteChannel()
    void (async () => {
      await channel.push(new Uint8Array([1, 2]))
      await channel.push(new Uint8Array([3]))
      channel.close()
    })()
    const read = new Uint8Array(
      await new Response(channel.stream).arrayBuffer(),
    )
    expect([...read]).toEqual([1, 2, 3])
  })

  it('makes the writer wait while the reader is far behind', async () => {
    const channel = new ByteChannel(10)
    let pushed = 0
    const writer = (async () => {
      for (let i = 0; i < 5; i += 1) {
        await channel.push(bytes(6))
        pushed += 1
      }
      channel.close()
    })()
    await new Promise((r) => setTimeout(r, 20))
    expect(pushed).toBeLessThan(5)
    const read = await new Response(channel.stream).arrayBuffer()
    await writer
    expect(read.byteLength).toBe(30)
    expect(pushed).toBe(5)
  })

  it('stops the writer when the reader goes away', async () => {
    const channel = new ByteChannel(4)
    const writing = channel.push(bytes(10))
    await channel.stream.cancel()
    await expect(writing).rejects.toThrow('archive reader went away')
    expect(channel.isCancelled).toBe(true)
    await expect(channel.push(bytes(1))).rejects.toThrow('went away')
  })

  it('passes a failure to the reader', async () => {
    const channel = new ByteChannel()
    channel.fail(new Error('database went away'))
    await expect(new Response(channel.stream).arrayBuffer()).rejects.toThrow(
      'database went away',
    )
  })
})
