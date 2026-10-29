/** Shared types and errors for the object-storage backends. */

/** Lifecycle states mirrored from the `file_objects.status` check. */
export type FileObjectStatus = 'active' | 'quarantined' | 'deleted' | 'missing'

export class OversizeError extends Error {
  constructor(
    message: string,
    readonly limit: number,
  ) {
    super(message)
    this.name = 'OversizeError'
  }
}

export class ChecksumMismatchError extends Error {
  constructor(
    message: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(message)
    this.name = 'ChecksumMismatchError'
  }
}

export class MissingStorageObjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingStorageObjectError'
  }
}

export interface PutResult {
  byteSize: bigint
  checksum: string
}

export interface ObjectStorage {
  /**
   * Stream `body` to a new object at `storageKey`, enforcing `maxBytes`.
   * Existing objects are never overwritten.
   * Returns the materialised byte size and sha256 checksum. Throws
   * `OversizeError` if the stream exceeds the cap; the partial object is
   * removed before returning.
   */
  putStream: (
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ) => Promise<PutResult>
  /**
   * Open a read stream for the object. Throws `MissingStorageObjectError`
   * if the object is absent.
   */
  getStream: (
    storageKey: string,
  ) => Promise<{ stream: ReadableStream<Uint8Array>; byteSize: number }>
  /** Returns the object size or null if it is absent. */
  head: (storageKey: string) => Promise<{ byteSize: number } | null>
  /** Remove the object. No-op if it is already absent. */
  delete: (storageKey: string) => Promise<void>
}
