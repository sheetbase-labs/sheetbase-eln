/**
 * Copy every stored file from one backend to another and check each copy
 * against the checksum recorded when the file was uploaded. Files are only
 * ever added to the destination; the source is removed only when asked to, and
 * only after its copy has been verified.
 */
import { createHash } from 'node:crypto'

import { MissingStorageObjectError } from './types'
import type { ObjectStorage } from './types'

export interface StoredFileRef {
  storageKey: string
  checksum: string | null
  byteSize: number
}

export interface CopyOptions {
  dryRun?: boolean
  deleteSource?: boolean
  maxBytes: number
  onProgress?: (line: string) => void
}

export interface CopyReport {
  copied: number
  alreadyThere: number
  missingFromSource: string[]
  failed: Array<{ storageKey: string; reason: string }>
}

async function sha256Of(stream: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash('sha256')
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    hash.update(value)
  }
  return hash.digest('hex')
}

export async function copyStoredFiles(
  files: StoredFileRef[],
  from: ObjectStorage,
  to: ObjectStorage,
  options: CopyOptions,
): Promise<CopyReport> {
  const report: CopyReport = {
    copied: 0,
    alreadyThere: 0,
    missingFromSource: [],
    failed: [],
  }
  for (const file of files) {
    const log = (message: string) =>
      options.onProgress?.(`${file.storageKey} ${message}`)
    try {
      const existing = await to.head(file.storageKey)
      let verified = false
      if (existing && existing.byteSize === file.byteSize) {
        // Present at the destination: trust it only if it matches the record.
        if (file.checksum) {
          const copy = await to.getStream(file.storageKey)
          verified = (await sha256Of(copy.stream)) === file.checksum
        } else {
          verified = true
        }
        if (verified) {
          report.alreadyThere++
          log('already there')
        }
      }
      if (!verified) {
        let source
        try {
          source = await from.getStream(file.storageKey)
        } catch (error) {
          if (error instanceof MissingStorageObjectError) {
            report.missingFromSource.push(file.storageKey)
            log('missing from the source')
            continue
          }
          throw error
        }
        if (options.dryRun) {
          report.copied++
          log('would copy')
          continue
        }
        if (existing) await to.delete(file.storageKey)
        const put = await to.putStream(
          file.storageKey,
          source.stream,
          options.maxBytes,
        )
        if (file.checksum && put.checksum !== file.checksum) {
          await to.delete(file.storageKey)
          report.failed.push({
            storageKey: file.storageKey,
            reason: 'the copy does not match the checksum recorded at upload',
          })
          log('checksum mismatch, copy removed')
          continue
        }
        report.copied++
        log('copied')
      }
      if (options.deleteSource && !options.dryRun) {
        await from.delete(file.storageKey)
        log('removed from the source')
      }
    } catch (error) {
      report.failed.push({
        storageKey: file.storageKey,
        reason: error instanceof Error ? error.message : String(error),
      })
      log(`failed: ${report.failed.at(-1)?.reason}`)
    }
  }
  return report
}
