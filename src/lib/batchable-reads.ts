/**
 * Which data requests may travel together in one read batch (see
 * `read-batch.ts` and `postgrest-batch.ts`). A batch only ever carries reads:
 * every table read, and the functions below, which are all declared STABLE in
 * the database (`tests/db/batchable-reads.test.ts` checks that). A function
 * that writes, even one that only notes a view, is never listed, so batching
 * can never reorder or merge a change.
 */
export const BATCHABLE_READ_RPCS: ReadonlySet<string> = new Set([
  'my_profile',
  'record_comments',
  'record_gates',
  'record_results',
  'record_series',
  'reporting_columns',
  'reporting_models',
  'workspace_member_photos',
])

/** A data path as the client builds it: `/records?id=eq.…` or `/rpc/name`. */
export function isBatchableRead(
  method: string | undefined,
  path: string,
): boolean {
  const verb = method ?? 'GET'

  if (verb === 'GET') return true

  if (verb !== 'POST') return false
  const match = /^\/rpc\/([a-z0-9_]+)(?:\?.*)?$/.exec(path)

  return match !== null && BATCHABLE_READ_RPCS.has(match[1])
}
