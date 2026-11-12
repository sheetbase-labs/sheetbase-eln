import { REMOTE_QUEUE_RE } from './settings'
import type { RemoteQueueOption } from './client'

/** `hpc-short:60, gpu.a100:2880` as queues; null when a part is not one. */
export function parseQueues(text: string): RemoteQueueOption[] | null {
  const parts = text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0 || parts.length > 50) return null
  const queues: RemoteQueueOption[] = []

  for (const part of parts) {
    const [name, minutes, ...extra] = part.split(':').map((s) => s.trim())

    if (extra.length > 0 || !REMOTE_QUEUE_RE.test(name)) return null

    if (minutes === undefined) {
      queues.push({ name })
      continue
    }

    const limit = Number(minutes)

    if (!Number.isInteger(limit) || limit < 1) return null
    queues.push({ name, maxMinutes: limit })
  }

  return new Set(queues.map((q) => q.name)).size === queues.length
    ? queues
    : null
}

/** The queues as a person types them. */
export function formatQueues(queues: RemoteQueueOption[]): string {
  return queues
    .map((q) => (q.maxMinutes ? `${q.name}:${q.maxMinutes}` : q.name))
    .join(', ')
}
