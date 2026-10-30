/**
 * A byte pipe with backpressure: the archive writer pushes chunks and waits
 * whenever the reader (a download, or a storage backend) is more than a few
 * megabytes behind, so a large workspace is never held in memory.
 */
export const CHANNEL_HIGH_WATER_BYTES = 8 * 1024 * 1024

export class ByteChannel {
  private queue: Uint8Array[] = []
  private queued = 0
  private closed = false
  private failure: unknown = null
  private cancelled = false
  private readWaiter: (() => void) | null = null
  private writeWaiter: (() => void) | null = null

  readonly stream: ReadableStream<Uint8Array>

  constructor(private readonly highWater = CHANNEL_HIGH_WATER_BYTES) {
    this.stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        for (;;) {
          if (this.failure) {
            controller.error(this.failure)
            return
          }
          const next = this.queue.shift()
          if (next) {
            this.queued -= next.byteLength
            this.writeWaiter?.()
            this.writeWaiter = null
            controller.enqueue(next)
            return
          }
          if (this.closed) {
            controller.close()
            return
          }
          await new Promise<void>((resolve) => {
            this.readWaiter = resolve
          })
        }
      },
      cancel: () => {
        this.cancelled = true
        this.queue = []
        this.queued = 0
        this.writeWaiter?.()
        this.writeWaiter = null
      },
    })
  }

  /** True once the reader has gone away; the writer should stop. */
  get isCancelled(): boolean {
    return this.cancelled
  }

  private gone(): boolean {
    return this.cancelled
  }

  async push(chunk: Uint8Array): Promise<void> {
    if (this.gone()) throw new Error('archive reader went away')
    if (chunk.byteLength === 0) return
    this.queue.push(chunk)
    this.queued += chunk.byteLength
    this.readWaiter?.()
    this.readWaiter = null
    while (this.queued > this.highWater && !this.gone()) {
      await new Promise<void>((resolve) => {
        this.writeWaiter = resolve
      })
    }
    if (this.gone()) throw new Error('archive reader went away')
  }

  close(): void {
    this.closed = true
    this.readWaiter?.()
    this.readWaiter = null
  }

  fail(error: unknown): void {
    this.failure = error ?? new Error('archive failed')
    this.readWaiter?.()
    this.readWaiter = null
  }
}
