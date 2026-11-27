import type { DataClient } from './data-client'
import {
  buildRelationshipRows,
  fetchRelationshipEndpoints,
  fetchRelationshipLinks,
  relationshipCounterpartyIds,
} from './relationships'
import type { RelationshipRow } from './relationships'
import { fetchReagentUsage } from './reagent-data'

/**
 * What a record page shows under "Related" and "Used in", for the assistant.
 *
 * It reads through the same functions the pages use (`relationships.ts`,
 * `reagent-data.ts`), so the assistant and the screen cannot disagree about
 * what a record is linked to or where a material is used.
 */

export interface LinkedItem {
  id: string | null
  title: string
  how: string
  state: string
}

export interface UsedInItem {
  id: string
  kind: string
  quantity: number | null
  unit: string | null
  on: string | null
}

export interface RecordLinks {
  linksTo: LinkedItem[]
  linkedFrom: LinkedItem[]
}

const LIMIT = 30

const item = (row: RelationshipRow): LinkedItem => ({
  id: row.identifier,
  title: row.title,
  how: row.label,
  state: row.state,
})

async function quiet<T>(job: Promise<T>, fallback: T): Promise<T> {
  try {
    return await job
  } catch {
    return fallback
  }
}

/** Links out of and into one record, as the record page's relationships panel lists them. */
export async function readRecordLinks(
  client: DataClient,
  recordId: string,
): Promise<RecordLinks> {
  const links = await quiet(fetchRelationshipLinks(client, recordId), {
    outgoing: [],
    incoming: [],
  })

  const datasets = links.outgoing
    .filter((link) => link.targetKind === 'dataset')
    .map((link) => link.targetRecordId ?? link.targetIdentifier)

  const endpoints = await quiet(
    fetchRelationshipEndpoints(
      client,
      relationshipCounterpartyIds(recordId, links),
      datasets,
    ),
    new Map(),
  )

  const rows = buildRelationshipRows(recordId, links, endpoints)

  return {
    linksTo: rows.outgoing.slice(0, LIMIT).map(item),
    linkedFrom: rows.incoming.slice(0, LIMIT).map(item),
  }
}

/** Where a material or reagent is used: the experiments, samples and protocols that link to it, as its page lists them. */
export async function readUsedIn(
  client: DataClient,
  identifier: string,
): Promise<UsedInItem[]> {
  const usage = await quiet(fetchReagentUsage(client, identifier, 25), [])

  return usage.map((link) => ({
    id: link.sourceIdentifier,
    kind: link.sourceKind,
    quantity: link.quantity,
    unit: link.unit,
    on: link.createdAt,
  }))
}
