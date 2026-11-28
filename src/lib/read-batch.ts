/**
 * Read batching for the browser data client. A page opens with dozens of small
 * reads (the record, its links, its project, its signatures …) that start in
 * the same few milliseconds. Sent one by one they queue behind the browser's
 * connection limit and each pays its own round trip; sent together they cost
 * one request per wave. Each read keeps its own status, body and row count, so
 * callers cannot tell the difference, and every read still runs as the signed
 * in person, so row-level security applies exactly as before.
 *
 * Reads that arrive within `BATCH_WINDOW_MS` of the first one go together. A
 * lone read is sent as the ordinary request it always was. Writes never batch.
 */
import { z } from 'zod'

import { isBatchableRead } from './batchable-reads'

/** The server route that runs a batch (`postgrest-batch.ts`). */
export const BATCH_URL = '/api/db-batch'

/** A page-level switch that keeps every read a request of its own (browser specs). */
export const UNBATCHED_FLAG = '__sheetbaseUnbatchedReads'

/** Longest a read waits for company before it is sent. */
export const BATCH_WINDOW_MS = 6

/** Most reads in one batch; the server refuses more, so the client splits. */
export const BATCH_MAX_READS = 40

export interface BatchReadInput {
  path: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
}

const batchResponse = z.object({
  results: z.array(
    z.object({
      status: z.number().int(),
      body: z.string(),
      contentRange: z.string().nullable(),
    }),
  ),
})

interface Waiting {
  read: BatchReadInput
  alone: () => Promise<Response>
  settle: (response: Response) => void
  fail: (error: Error) => void
}

let enabled = false
let waiting: Waiting[] = []
let timer: ReturnType<typeof setTimeout> | null = null

/** Turns batching on for the browser app. Tests leave it off unless they ask. */
export function enableReadBatching(): void {
  // Browser specs that answer a read by its own URL set this before the page
  // loads, so each read stays a request of its own for them to answer.
  if (Reflect.get(globalThis, UNBATCHED_FLAG) === true) return

  enabled = true
}

/** Back to the default (off) with nothing queued; tests call it in afterEach. */
export function resetReadBatching(): void {
  enabled = false
  waiting = []

  if (timer) clearTimeout(timer)
  timer = null
}

export function readBatchingEnabled(): boolean {
  return enabled
}

function responseFor(
  status: number,
  body: string,
  contentRange: string | null,
): Response {
  const headers = new Headers({ 'content-type': 'application/json' })

  if (contentRange) headers.set('content-range', contentRange)
  // A response with these statuses may not carry a body at all.
  const bodyless = status === 204 || status === 205 || status === 304

  return new Response(bodyless ? null : body, { status, headers })
}

async function flushGroup(
  group: Waiting[],
  send: (url: string, init: RequestInit) => Promise<Response>,
  stamp: (headers: Headers) => void,
): Promise<void> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json',
  })

  stamp(headers)

  try {
    const response = await send(BATCH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reads: group.map((entry) => entry.read) }),
    })

    if (response.status === 404 || response.status === 405) {
      // A server that does not know batches yet (a deploy in flight): ask one by one.
      await Promise.all(
        group.map((entry) => entry.alone().then(entry.settle, entry.fail)),
      )

      return
    }

    if (!response.ok) {
      // The whole batch was refused (signed out, rate limited): every read
      // sees that answer, the same as if it had been sent alone.
      const text = await response.text()

      group.forEach((entry) =>
        entry.settle(
          responseFor(
            response.status,
            text,
            response.headers.get('content-range'),
          ),
        ),
      )

      return
    }

    const parsed = batchResponse.safeParse(await response.json())

    if (!parsed.success || parsed.data.results.length !== group.length) {
      await Promise.all(
        group.map((entry) => entry.alone().then(entry.settle, entry.fail)),
      )

      return
    }

    parsed.data.results.forEach((result, index) =>
      group[index].settle(
        responseFor(result.status, result.body, result.contentRange),
      ),
    )
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))

    group.forEach((entry) => entry.fail(failure))
  }
}

/**
 * Queues a read. `alone` sends it as an ordinary request; it runs when the read
 * waits alone or when the batch route is not available. `send` is the transport
 * for the batch itself and `stamp` adds the headers every data request carries.
 */
export function queueRead(
  read: BatchReadInput,
  alone: () => Promise<Response>,
  send: (url: string, init: RequestInit) => Promise<Response>,
  stamp: (headers: Headers) => void,
): Promise<Response> | null {
  if (!enabled || !isBatchableRead(read.method, read.path)) return null

  return new Promise<Response>((settle, fail) => {
    waiting.push({ read, alone, settle, fail })

    if (timer) return

    timer = setTimeout(() => {
      const entries = waiting

      waiting = []
      timer = null

      if (entries.length === 1) {
        entries[0].alone().then(entries[0].settle, entries[0].fail)

        return
      }

      for (let start = 0; start < entries.length; start += BATCH_MAX_READS) {
        void flushGroup(
          entries.slice(start, start + BATCH_MAX_READS),
          send,
          stamp,
        )
      }
    }, BATCH_WINDOW_MS)
  })
}
