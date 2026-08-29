/**
 * PLAT-05 — file platform benchmark.
 *
 * Exercises the canonical local `ObjectStorage` backend directly (the byte
 * path behind the upload/download routes): streamed put, streamed get and
 * checksum, at realistic sizes up to the 100 MiB product cap. Byte routes add
 * only HTTP framing + auth over this; they stream the same ReadableStream and
 * never buffer the whole file.
 */
import './lib/loadenv'
import { getObjectStorage } from '#/lib/file-storage'
import type { ObjectStorage } from '#/lib/file-storage'

import {
  adminClient,
  assertPerfEnvironment,
  environmentSnapshot,
  recordScenario,
  statsFor,
  writeReport,
} from './lib/common'
import type { ScenarioReport } from './lib/common'

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MiB`
}

/** Deterministic payload bytes (no crypto overhead in the hot path). */
function payload(bytes: number): Uint8Array {
  const chunk = new Uint8Array(64 * 1024)
  for (let i = 0; i < chunk.length; i += 1) chunk[i] = (i * 31) % 251
  const out = new Uint8Array(bytes)
  for (let offset = 0; offset < bytes; offset += chunk.length) {
    out.set(chunk.subarray(0, Math.min(chunk.length, bytes - offset)), offset)
  }
  return out
}

async function main(): Promise<void> {
  const env = assertPerfEnvironment()
  const storage: ObjectStorage = getObjectStorage()
  const scenarios: ScenarioReport[] = []
  const sizes = [10 * 1024 * 1024, 50 * 1024 * 1024, 100 * 1024 * 1024]
  const admin = await adminClient(env.migrationDatabaseUrl)
  try {
    for (const size of sizes) {
      const bytes = payload(size)
      const writeSamples: number[] = []
      const keys: string[] = []
      for (let i = 0; i < 3; i += 1) {
        const key = `perf-bench/${Date.now()}-${Math.random().toString(36).slice(2)}`
        keys.push(key)
        const t0 = Date.now()
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        })
        await storage.putStream(key, body, size)
        writeSamples.push(Date.now() - t0)
      }
      const readSamples: number[] = []
      let checksumOk = true
      for (const key of keys) {
        const t0 = Date.now()
        const { stream, byteSize } = await storage.getStream(key)
        const reader = stream.getReader()
        let received = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.length
        }
        readSamples.push(Date.now() - t0)
        if (received !== byteSize || received !== bytes.length)
          checksumOk = false
      }
      const writeStats = statsFor(writeSamples)
      const readStats = statsFor(readSamples)
      scenarios.push(
        recordScenario({
          scenario: `file-write-${mb(size)}`,
          rows: size,
          concurrency: 1,
          iterations: writeSamples.length,
          throughput: Math.round(
            size / (writeStats.p50_ms / 1000) / (1024 * 1024),
          ),
          stats: writeStats,
          notes: { operation: 'write', kind: 'streamed' },
        }),
        recordScenario({
          scenario: `file-read-${mb(size)}`,
          rows: size,
          concurrency: 1,
          iterations: readSamples.length,
          throughput: Math.round(
            size / (readStats.p50_ms / 1000) / (1024 * 1024),
          ),
          stats: readStats,
          notes: { operation: 'read', kind: 'streamed', checksumOk },
        }),
      )
      for (const key of keys) {
        await storage.delete(key)
      }
    }
    const environment = await environmentSnapshot(admin)
    writeReport('files', scenarios, environment, {
      backend: process.env.FILE_STORAGE_BACKEND ?? 'local',
      cap: '100 MiB',
    })
  } finally {
    await admin.end().catch(() => {})
  }
}

if (process.argv[1]?.endsWith('perf/files.ts')) {
  void main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
